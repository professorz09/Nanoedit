// Calls one of the Supabase functions that our own API server (server/api-server.ts on Oracle) can
// also run — transcript, match-style, index-style, admin-styles. With VITE_API_URL set, the server's
// /fn/<name> is tried first, so the keys those functions need can live only on the server; when it
// isn't set up for that function (404/405/501) or can't be reached, the Supabase function answers.
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '');

export const postFunction = async (name: string, body: unknown, token: string): Promise<Response> => {
  const payload = JSON.stringify(body);
  if (API_BASE) {
    try {
      const resp = await fetch(`${API_BASE}/fn/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: payload,
      });
      if (resp.status !== 404 && resp.status !== 405 && resp.status !== 501) return resp;
    } catch {
      // server unreachable — the Supabase function below
    }
  }
  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supaUrl) throw new Error('Not configured.');
  return fetch(`${supaUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supaAnon ?? '' },
    body: payload,
  });
};
