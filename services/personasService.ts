import { supabase } from './supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Saved faces ("personas") — lets a user upload a face once and reuse it across
// generations instead of re-uploading every time. Backed by the `personas`
// Storage bucket (private) + public.user_personas table, both already scoped by
// RLS to the owning user (see migration 0006) — no admin/global path exists.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'personas';
const MAX_PERSONAS = 8; // UX cap on the picker strip, not a security boundary
const SIGNED_URL_TTL = 60 * 60 * 24; // 1 day — long enough for a single session

export interface Persona {
  id: string;
  name: string | null;
  path: string;
  url: string;
}

const dataUrlToBlob = (dataUrl: string): { blob: Blob; mime: string } => {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  const mime = m?.[1] || 'image/jpeg';
  const bin = atob(m?.[2] || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { blob: new Blob([bytes], { type: mime }), mime };
};

export const fetchPersonas = async (): Promise<Persona[]> => {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('user_personas')
    .select('id, path, name')
    .order('created_at', { ascending: false })
    .limit(MAX_PERSONAS);
  if (error || !data) return [];
  const withUrls = await Promise.all(data.map(async (row: any) => {
    const { data: signed } = await supabase!.storage.from(BUCKET).createSignedUrl(row.path, SIGNED_URL_TTL);
    return { id: row.id, name: row.name, path: row.path, url: signed?.signedUrl || '' };
  }));
  return withUrls.filter(p => p.url);
};

export const savePersona = async (dataUrl: string, name?: string): Promise<Persona> => {
  if (!supabase) throw new Error('Not configured.');
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Please sign in to save a face.');

  const { count } = await supabase.from('user_personas').select('id', { count: 'exact', head: true }).eq('user_id', uid);
  if ((count ?? 0) >= MAX_PERSONAS) throw new Error(`You can save up to ${MAX_PERSONAS} faces. Delete one to add another.`);

  const { blob, mime } = dataUrlToBlob(dataUrl);
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const path = `${uid}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw new Error('Could not save that face.');

  const { data: row, error } = await supabase
    .from('user_personas')
    .insert({ user_id: uid, path, name: name || null })
    .select('id, path, name')
    .single();
  if (error || !row) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error('Could not save that face.');
  }

  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  return { id: row.id, name: row.name, path: row.path, url: signed?.signedUrl || '' };
};

export const deletePersona = async (persona: Persona): Promise<void> => {
  if (!supabase) return;
  await supabase.from('user_personas').delete().eq('id', persona.id);
  await supabase.storage.from(BUCKET).remove([persona.path]).catch(() => {});
};
