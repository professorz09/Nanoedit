// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function: "delete-generation"
// Deletes a generated thumbnail server-side (Storage object + `generations`
// row) for the calling user. Needed because the client only has SELECT
// access to `generations` (see migration 0003) — without this, deleting a
// thumbnail client-side only removed it from local state; the next reload's
// restore-from-server merge (App.tsx) would just bring it right back since
// the server never learned it was deleted.
//
// Flow: browser POSTs { url } (the public Storage URL it's displaying). We
// derive the storage path from that URL, then delete the Storage object and
// the `generations` row — both scoped to `user_id = auth.uid()` so a user can
// only ever delete their own thumbnails, never anyone else's.
//
// Always returns 200 (best-effort) unless auth fails — a locally-generated
// image that hasn't hit the `generations` table yet, or one already deleted,
// isn't an error from the client's point of view; the local delete should
// never be blocked by this.
//
// Deploy:  supabase functions deploy delete-generation --project-ref vowgdlbvundorxwjdntu --use-api
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false },
    });

    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '').trim();
    if (!jwt) return json(401, { error: 'Please sign in to continue.' });
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json(401, { error: 'Please sign in to continue.' });
    const uid = userData.user.id;

    let body: any;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
    const url = typeof body?.url === 'string' ? body.url : '';
    if (!url) return json(200, { ok: true }); // nothing to do

    // The public URL is always "<SUPABASE_URL>/storage/v1/object/public/thumbnails/<path>"
    // (see generate/index.ts, where it's built with getPublicUrl). Anything
    // that doesn't match — a data: URL, a foreign host — has no server-side
    // row to clean up, so it's a no-op rather than an error.
    const marker = '/storage/v1/object/public/thumbnails/';
    const idx = url.indexOf(marker);
    if (idx === -1) return json(200, { ok: true, skipped: 'not a thumbnails storage url' });
    const path = decodeURIComponent(url.slice(idx + marker.length));
    if (!path) return json(200, { ok: true });

    // Scoped to this user's own rows — even a tampered path can't touch
    // another user's file or row.
    const { data: rows, error: selErr } = await admin
      .from('generations').select('id, path').eq('user_id', uid).eq('path', path);
    if (selErr) {
      console.error('delete_generation_select_failed', selErr.message);
      return json(500, { error: 'Could not delete. Please try again.' });
    }
    if (!rows || rows.length === 0) return json(200, { ok: true, skipped: 'no matching row' });

    const { error: storageErr } = await admin.storage.from('thumbnails').remove([path]);
    if (storageErr) {
      // Leave the row in place so a retried delete (or the rolling
      // MAX_THUMBNAILS_PER_USER cleanup in generate/index.ts, which prunes
      // the same way) can still find and clean up the object later — a
      // leftover DB row is harmless (worst case: a future cleanup pass finds
      // nothing to remove), but an orphaned Storage object with no row
      // pointing at it would never get cleaned up at all.
      console.error('delete_generation_storage_failed', storageErr.message);
      return json(200, { ok: true, storageCleanupFailed: true });
    }

    const { error: delErr } = await admin.from('generations').delete().eq('user_id', uid).eq('path', path);
    if (delErr) {
      console.error('delete_generation_row_failed', delErr.message);
      return json(500, { error: 'Could not delete. Please try again.' });
    }

    return json(200, { ok: true });
  } catch (e: any) {
    console.error('delete_generation_unhandled', e?.message || String(e));
    return json(500, { error: 'Could not delete. Please try again.' });
  }
});
