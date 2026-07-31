import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabase';

// ─────────────────────────────────────────────────────────────────────────────
// Style / reference thumbnails, sourced from the database.
//
// The "Styles" pool used to be hard-coded from the client bundle
// (attached_assets/*). Now it's data-driven: rows in public.style_images point
// at files in the public "styles" Storage bucket. Add a row (see
// scripts/seed-styles.mjs) and it appears in the app — no rebuild.
//
// The bundled images stay as an offline/first-paint fallback: until the DB has
// styles (or if Supabase isn't configured), we render the bundled pool.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'styles';
let cache: string[] | null = null;

// AI-derived topic tags for a style (see scripts/tag-styles.mjs). All fields are
// model-derived and optional — the matcher treats missing tags gracefully.
// Structured, editable "slots" a style breaks down into — used by the Recreate
// tab (dynamic fields) AND the YouTube auto-style flow (smart substitution). All
// model-derived, all optional; absent on styles indexed before this shipped.
export interface StyleElements {
  faces?: { id?: string; position?: string }[];
  texts?: { id?: string; current?: string; position?: string; style?: string }[];
  background?: { description?: string };
  other?: { id?: string; label?: string }[];
}

export interface StyleMeta {
  niche?: string;
  keywords?: string[];
  emotion?: string;
  colors?: string[];
  composition?: string;
  has_face?: boolean;
  text_density?: 'none' | 'low' | 'high';
  summary?: string;
  elements?: StyleElements;
}

export interface StyleImage {
  url: string;
  name?: string;
  meta: StyleMeta;
}

export interface StyleMatch extends StyleImage {
  similarity?: number;
}

/**
 * Vector search: given a video's topic text, return the closest-matching styles
 * (ranked by cosine similarity) via the secure "match-style" Edge Function. The
 * function embeds the text server-side (the Vertex key never ships to the
 * browser) and runs the match_styles() RPC. Returns [] on any problem (not
 * signed in, styles not indexed yet, network error) so callers can fall back.
 */
export const matchStyles = async (text: string, count = 8): Promise<StyleMatch[]> => {
  try {
    const t = text.trim();
    if (!t || !isSupabaseConfigured || !supabase) return [];
    const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    if (!supaUrl) return [];
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return []; // not signed in → caller falls back to the classic flow
    const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    const resp = await fetch(`${supaUrl}/functions/v1/match-style`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supaAnon ?? '' },
      body: JSON.stringify({ text: t, count }),
    });
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => ({}));
    return Array.isArray(data?.styles) ? (data.styles as StyleMatch[]) : [];
  } catch {
    return [];
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Custom styles + personas (hybrid ownership — see migration 0007).
// ─────────────────────────────────────────────────────────────────────────────
const PERSONA_BUCKET = 'personas';
const genId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fileExt = (f: File) => ((f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg');

// A full style row for the UI (Recreate tab + "My Styles"): carries id, meta and
// whether it belongs to the current user (own = deletable, else a global default).
export interface StyleRecord {
  id: string;
  path: string;
  url: string;
  name?: string;
  meta: StyleMeta;
  own: boolean;
}

export interface PersonaRecord {
  id: string;
  path: string;
  name?: string;
  url: string; // short-lived signed URL (private bucket)
}

const toUrl = (path: string) =>
  /^https?:\/\//.test(path) ? path : supabase!.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

/**
 * Full style objects (global defaults + the signed-in user's own, courtesy of
 * RLS) WITH their AI meta — used by the Recreate tab's dynamic fields and the
 * "My Styles" manager. Empty array on any problem.
 */
export const fetchStyleObjects = async (): Promise<StyleRecord[]> => {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('style_images')
      .select('id, path, name, meta, user_id')
      .eq('active', true)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map((r: any) => ({
      id: r.id,
      path: r.path,
      url: toUrl(r.path),
      name: r.name ?? undefined,
      meta: (r.meta ?? {}) as StyleMeta,
      own: !!r.user_id && r.user_id === user?.id,
    }));
  } catch {
    return [];
  }
};

/**
 * Upload a user's own style thumbnail, then index it (vision-tag + embed) via
 * the secure "index-style" Edge Function. On failure the orphaned upload is
 * rolled back so the per-user cap count stays honest.
 */
export const uploadCustomStyle = async (
  file: File,
  name?: string,
): Promise<{ ok: boolean; error?: string; style?: StyleRecord }> => {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: 'Storage is not configured.' };
  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const uid = session?.user?.id;
  if (!token || !uid || !supaUrl) return { ok: false, error: 'Please sign in to add styles.' };

  const path = `user/${uid}/${genId()}.${fileExt(file)}`;
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) return { ok: false, error: up.error.message };

  try {
    const resp = await fetch(`${supaUrl}/functions/v1/index-style`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supaAnon ?? '' },
      body: JSON.stringify({ path, name }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
      return { ok: false, error: data?.error || 'Could not index that image.' };
    }
    cache = null; // bust the URL cache so the new style appears
    const s = data.style || {};
    return { ok: true, style: { id: s.id, path: s.path ?? path, url: s.url ?? toUrl(path), name: s.name ?? name, meta: (s.meta ?? {}) as StyleMeta, own: true } };
  } catch (e: any) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: e?.message || 'Network error.' };
  }
};

// Delete one of the user's own styles (row + file). RLS blocks touching globals.
export const deleteStyle = async (id: string, path: string): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.from('style_images').delete().eq('id', id);
    if (error) return false;
    if (path && !/^https?:\/\//.test(path)) await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    cache = null;
    return true;
  } catch {
    return false;
  }
};

// ── Personas (private bucket → signed URLs) ──────────────────────────────────
export const fetchPersonas = async (): Promise<PersonaRecord[]> => {
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('user_personas')
      .select('id, path, name')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    const out: PersonaRecord[] = [];
    for (const r of data as any[]) {
      const signed = await supabase.storage.from(PERSONA_BUCKET).createSignedUrl(r.path, 3600);
      out.push({ id: r.id, path: r.path, name: r.name ?? undefined, url: signed.data?.signedUrl || '' });
    }
    return out;
  } catch {
    return [];
  }
};

export const uploadPersona = async (file: File, name?: string): Promise<{ ok: boolean; error?: string }> => {
  if (!isSupabaseConfigured || !supabase) return { ok: false, error: 'Storage is not configured.' };
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id;
  if (!uid) return { ok: false, error: 'Please sign in.' };
  const path = `${uid}/${genId()}.${fileExt(file)}`;
  const up = await supabase.storage.from(PERSONA_BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) return { ok: false, error: up.error.message };
  const { error } = await supabase.from('user_personas').insert({ user_id: uid, path, name: name ?? null });
  if (error) { await supabase.storage.from(PERSONA_BUCKET).remove([path]).catch(() => {}); return { ok: false, error: error.message }; }
  return { ok: true };
};

export const deletePersona = async (id: string, path: string): Promise<boolean> => {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const { error } = await supabase.from('user_personas').delete().eq('id', id);
    if (error) return false;
    await supabase.storage.from(PERSONA_BUCKET).remove([path]).catch(() => {});
    return true;
  } catch {
    return false;
  }
};

// Fetch the active style image URLs from the DB (empty array on any problem).
export const fetchStyleImages = async (): Promise<string[]> => {
  if (cache) return cache;
  if (!isSupabaseConfigured || !supabase) return [];
  try {
    const { data, error } = await supabase
      .from('style_images')
      .select('path')
      .eq('active', true)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    const urls = data
      .map((r: { path?: string }) => r.path)
      .filter((p): p is string => !!p)
      .map((p) => (/^https?:\/\//.test(p) ? p : supabase!.storage.from(BUCKET).getPublicUrl(p).data.publicUrl));
    cache = urls;
    return urls;
  } catch {
    return [];
  }
};

/**
 * Returns the style pool to render. Renders `bundled` immediately for a fast
 * first paint, then — once the DB responds with at least one style — switches to
 * the DB list (the source of truth, so admins can add/remove without a redeploy).
 */
export const useStyleImages = (bundled: string[]): string[] => {
  const [remote, setRemote] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchStyleImages().then((urls) => { if (alive) setRemote(urls); });
    return () => { alive = false; };
  }, []);
  return remote && remote.length ? remote : bundled;
};
