import { supabase } from './supabase';
import { GeneratedImage } from '../types';

// Cross-device history. Every successful generation is saved server-side (the
// `generate` Edge Function inserts a `generations` row + uploads to the public
// `thumbnails` bucket). The app's local cache (IndexedDB) is per-device, so on a
// fresh device / browser the user saw nothing. This pulls their saved thumbnails
// back from Supabase so history follows the account, not the device.
//
// RLS ("read own generations": auth.uid() = user_id) already scopes the read to
// the signed-in user, and the bucket is public so getPublicUrl is a plain CDN
// link. Returns [] when logged out or on any failure (history stays local-only).
export const fetchUserGenerations = async (limit = 60): Promise<GeneratedImage[]> => {
  if (!supabase) return [];
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return [];

    const { data, error } = await supabase
      .from('generations')
      .select('id, prompt, path, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];

    return data.map((row: any) => {
      const { data: pub } = supabase!.storage.from('thumbnails').getPublicUrl(row.path);
      return {
        id: `db-${row.id}`,
        url: pub.publicUrl,
        prompt: row.prompt || '',
        timestamp: row.created_at ? Date.parse(row.created_at) : 0,
      } as GeneratedImage;
    });
  } catch (e) {
    console.error('fetchUserGenerations failed', e);
    return [];
  }
};
