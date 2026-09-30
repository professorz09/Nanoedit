// Calls one of the functions our own API server (server/api-server.ts on Oracle) runs at /fn/<name> —
// transcript, match-style, index-style, admin-styles, create-checkout, delete-generation.
// user-decided: everything runs on Oracle — no Supabase Edge Function fallback.
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '');

export const postFunction = async (name: string, body: unknown, token: string, init?: { signal?: AbortSignal }): Promise<Response> => {
  if (!API_BASE) throw new Error('The server is not configured. Please contact support.');
  return fetch(`${API_BASE}/fn/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
};
