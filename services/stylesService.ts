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
