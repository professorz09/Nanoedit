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
const SIGNED_URL_TTL = 60 * 60 * 24; // 1 day, matches personasService
let cache: string[] | null = null;
// Both the studio and the editor mount a useStyleImages() consumer, and either
// can be the first to ask — without this, both would fire their own query the
// instant they're both enabled. Cache the in-flight request itself so every
// caller shares ONE round trip to Supabase, not one each.
let inflight: Promise<string[] | null> | null = null;

// Fetch the active, picker-visible style image URLs from the DB. `show_in_picker`
// is independent of `active` — an admin can hide a style from THIS manual list
// while it stays fully eligible for the YouTube auto-match flow (matchStyles()
// below never checks show_in_picker).
//
// Returns `null` when the DB genuinely couldn't be reached (not configured,
// network/query error) — as opposed to `[]`, which means the query succeeded
// and there are simply zero active+visible styles right now (e.g. an admin
// hid every global style from the picker). useStyleImages() below only falls
// back to the bundled pool for `null` — otherwise a legitimately empty picker
// would incorrectly repopulate itself from the bundled images.
export const fetchStyleImages = async (): Promise<string[] | null> => {
  if (cache) return cache;
  if (inflight) return inflight;
  if (!isSupabaseConfigured || !supabase) return null;
  inflight = (async () => {
    try {
      const { data, error } = await supabase!
        .from('style_images')
        .select('path')
        .eq('active', true)
        .eq('show_in_picker', true)
        .order('sort', { ascending: true })
        .order('created_at', { ascending: true });
      if (error || !data) return null;
      const paths = data.map((r: { path?: string }) => r.path).filter((p): p is string => !!p);
      // Per-user custom styles (styles/user/<uid>/...) are RLS-scoped to their
      // owner at the Storage level, so a plain public URL 403s even for the
      // owner — sign those specifically. Global styles (admin/, seed/) stay
      // public URLs: no round trip, and there's nothing owner-scoped to leak.
      const urls = await Promise.all(paths.map(async (p) => {
        if (/^https?:\/\//.test(p)) return p;
        if (p.startsWith('user/')) {
          const { data: signed } = await supabase!.storage.from(BUCKET).createSignedUrl(p, SIGNED_URL_TTL);
          return signed?.signedUrl || '';
        }
        return supabase!.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
      }));
      cache = urls.filter(Boolean);
      return cache;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

export interface MatchedStyle {
  url: string;
  name: string | null;
  meta: any;
  similarity: number | null;
}

/**
 * Vector-search the style pool (global + the caller's own custom styles) for
 * the ones that best fit a topic — powers the YouTube auto-style flow so
 * generation is grounded in one of OUR curated thumbnails instead of the
 * video's own (often low-quality) one. Costs 1 credit server-side (the
 * "match-style" Edge Function), refunded on failure. Returns [] on any
 * problem (not signed in, no credits, network) — callers should fall back to
 * the plain style pool (fetchStyleImages/useStyleImages) rather than block.
 *
 * `ownOnly` restricts the search to just the caller's own uploaded custom
 * styles, excluding the global pool entirely (migration 0019).
 */
export const matchStyles = async (text: string, count = 8, ownOnly = false): Promise<MatchedStyle[]> => {
  if (!supabase) return [];
  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supaUrl) return [];
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return [];
    const resp = await fetch(`${supaUrl}/functions/v1/match-style`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supaAnon ?? '' },
      body: JSON.stringify({ text, count, ownOnly }),
    });
    if (!resp.ok) return [];
    const data = await resp.json().catch(() => ({}));
    return Array.isArray(data?.styles) ? data.styles : [];
  } catch {
    return [];
  }
};

/**
 * Returns the style pool to render. Renders `bundled` immediately for a fast
 * first paint. Nothing is fetched from Supabase until `enabled` is true — the
 * style pool is only actually needed once the user opens the styles/templates
 * picker, so a visit that never opens it costs zero DB/Storage calls. Once
 * fetched, the module-level cache above makes every later mount (or the other
 * screen's own useStyleImages call) instant with no extra request.
 */
export const useStyleImages = (bundled: string[], enabled: boolean = true): string[] => {
  // undefined = not fetched yet; null = fetch failed/unavailable; string[] =
  // a real result from the DB, which may legitimately be empty.
  const [remote, setRemote] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled || remote !== undefined) return;
    let alive = true;
    fetchStyleImages().then((urls) => { if (alive) setRemote(urls); });
    return () => { alive = false; };
  }, [enabled, remote]);
  return remote != null ? remote : bundled;
};

// ─────────────────────────────────────────────────────────────────────────────
// A user's own custom styles — uploaded from the Profile page (see Account.tsx),
// backed by the SAME `style_images` table + `styles` bucket as the global pool
// (migration 0006), just owned (`user_id`) instead of global. RLS on both the
// table ("read styles") and the bucket ("read styles bucket", migration 0017)
// already scope `user/<uid>/...` rows/objects to their owner, so once uploaded
// a style is private to its owner AND automatically appears in that owner's
// "Styles" picker via fetchStyleImages() above — no separate wiring needed
// there. The "index-style" Edge Function does the actual insert (it vision-tags
// + embeds the image so it also joins the owner's YouTube auto-match pool).
// ─────────────────────────────────────────────────────────────────────────────

export interface UserStyle {
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

export const fetchMyStyles = async (): Promise<UserStyle[]> => {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return [];
  const { data, error } = await supabase
    .from('style_images')
    .select('id, path, name')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  const withUrls = await Promise.all(data.map(async (row: any) => {
    const { data: signed } = await supabase!.storage.from(BUCKET).createSignedUrl(row.path, SIGNED_URL_TTL);
    return { id: row.id, name: row.name, path: row.path, url: signed?.signedUrl || '' };
  }));
  return withUrls.filter(s => s.url);
};

export const uploadMyStyle = async (dataUrl: string, name?: string): Promise<UserStyle> => {
  if (!supabase) throw new Error('Not configured.');
  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supaUrl) throw new Error('Not configured.');
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) throw new Error('Please sign in to save a style.');

  const { blob, mime } = dataUrlToBlob(dataUrl);
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  const path = `user/${uid}/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (up.error) throw new Error('Could not upload that image.');

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) { await supabase.storage.from(BUCKET).remove([path]).catch(() => {}); throw new Error('Please sign in.'); }

  const resp = await fetch(`${supaUrl}/functions/v1/index-style`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supaAnon ?? '' },
    body: JSON.stringify({ path, name }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data?.style) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(data?.error || 'Could not save that style.');
  }
  cache = null; // so this new style shows up next time the Styles picker fetches
  return { id: data.style.id, name: data.style.name, path: data.style.path, url: data.style.url };
};

export const deleteMyStyle = async (style: UserStyle): Promise<boolean> => {
  if (!supabase) return false;
  const { error } = await supabase.from('style_images').delete().eq('id', style.id);
  if (error) return false;
  await supabase.storage.from(BUCKET).remove([style.path]).catch(() => {});
  cache = null;
  return true;
};
