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
let inflight: Promise<string[]> | null = null;

// Fetch the active style image URLs from the DB (empty array on any problem).
export const fetchStyleImages = async (): Promise<string[]> => {
  if (cache) return cache;
  if (inflight) return inflight;
  if (!isSupabaseConfigured || !supabase) return [];
  inflight = (async () => {
    try {
      const { data, error } = await supabase!
        .from('style_images')
        .select('path')
        .eq('active', true)
        .order('sort', { ascending: true })
        .order('created_at', { ascending: true });
      if (error || !data) return [];
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
      return [];
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
 */
export const matchStyles = async (text: string, count = 8): Promise<MatchedStyle[]> => {
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
      body: JSON.stringify({ text, count }),
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
  const [remote, setRemote] = useState<string[] | null>(null);
  useEffect(() => {
    if (!enabled || remote) return;
    let alive = true;
    fetchStyleImages().then((urls) => { if (alive) setRemote(urls); });
    return () => { alive = false; };
  }, [enabled]);
  return remote && remote.length ? remote : bundled;
};
