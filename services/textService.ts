import { supabase } from './supabase';

export interface TranscriptSegment {
  start: number; // seconds
  text: string;
}

// Format seconds → HH:MM:SS (always shows hours for consistent chapter look)
export const formatTime = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(ss)}`;
};

/** Which operation this prompt is for — the server (not the client) decides
 *  what each one costs, so this can't be used to spoof a lower/zero cost. */
export type TextOp = 'title' | 'chapters' | 'concept';

/**
 * Generate plain text with a Gemini text model.
 * DEV  → local proxy (/api/text); the key stays in the Vite/Node server.
 * PROD → secure Supabase Edge Function (/functions/v1/text); requires sign-in,
 *        and the LLM key never ships to the browser.
 */
export const generateText = async (prompt: string, op: TextOp): Promise<string> => {
  if (import.meta.env?.DEV) {
    const resp = await fetch('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, op }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error || `Text service error ${resp.status}`);
    if (!data.text) throw new Error('No text generated.');
    return data.text as string;
  }

  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supaUrl || !supabase) throw new Error('Please sign in to use this tool.');

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Please sign in to use this tool.');

  const requestBody = JSON.stringify({ prompt, op });

  // Two server-side options, tried in order — same arrangement (and the same
  // reason) as image generation in geminiService.ts:
  //
  //   1. /api/text (Vercel, same origin) — Vercel Functions get up to 300s,
  //      well past the Supabase Free plan's hard 150s wall-clock kill. The
  //      Chapter Maker can hand over 32k characters of transcript to the
  //      bigger model, which is exactly the kind of run that hits that wall.
  //   2. Supabase Edge Function — used until the Vercel secrets are added
  //      (api/text.ts self-reports 501 "not_configured" until then), or if the
  //      Vercel route isn't deployed.
  //
  // 'skip' means the route isn't there / isn't configured, so it's safe to try
  // the other one. Anything else is a real outcome from THIS endpoint and is
  // thrown — a paid op must never be retried against the second endpoint, or a
  // failed-looking run bills the user twice.
  const tryEndpoint = async (
    url: string,
    headers: Record<string, string>,
    treatAsSkip: (status: number) => boolean,
  ): Promise<string | 'skip'> => {
    let resp: Response;
    try {
      resp = await fetch(url, { method: 'POST', headers, body: requestBody });
    } catch {
      return 'skip';
    }
    if (treatAsSkip(resp.status)) return 'skip';
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error || `Text service error ${resp.status}`);
    if (!data.text) throw new Error('No text generated.');
    return data.text as string;
  };

  const viaVercel = await tryEndpoint(
    '/api/text',
    { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    (status) => status === 404 || status === 501,
  );
  if (viaVercel !== 'skip') return viaVercel;

  const viaSupabase = await tryEndpoint(
    `${supaUrl}/functions/v1/text`,
    { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supaAnon ?? '' },
    () => false,
  );
  if (viaSupabase !== 'skip') return viaSupabase;
  throw new Error('No text generated.');
};

/**
 * Fetch a YouTube transcript (timestamped).
 * DEV  → local proxy (/api/transcript); the Supadata key stays in the Vite server.
 * PROD → secure Supabase Edge Function (/functions/v1/transcript); requires
 *        sign-in, and the Supadata key never ships to the browser.
 * Returns null when unavailable (no captions / not signed in) so the caller can
 * fall back to a manual transcript paste.
 */
export const fetchTranscript = async (videoId: string): Promise<TranscriptSegment[] | null> => {
  try {
    // DEV: route through the proxy so the Supadata key stays server-side.
    if (import.meta.env?.DEV) {
      const resp = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) return null;
      const segments: TranscriptSegment[] = data.segments || [];
      return segments.length ? segments : null;
    }

    // PROD: call the secure Edge Function. The Supadata key lives as a Supabase
    // secret and is NEVER bundled into the browser.
    const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!supaUrl || !supabase) return null;

    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null; // not signed in → fall back to manual paste

    const resp = await fetch(`${supaUrl}/functions/v1/transcript`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supaAnon ?? '',
      },
      body: JSON.stringify({ videoId }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) return null;
    const segments: TranscriptSegment[] = data.segments || [];
    return segments.length ? segments : null;
  } catch {
    return null;
  }
};

// Compress raw pasted transcript / segments into a token-friendly timestamped block.
export const segmentsToText = (segments: TranscriptSegment[]): string =>
  segments.map(s => `[${formatTime(s.start)}] ${s.text}`).join('\n');
