import { GoogleGenAI } from '@google/genai';

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

/**
 * Generate plain text with a Gemini text model.
 * DEV routes through the local Vertex proxy (/api/text) so the service-account
 * key stays server-side; PROD uses Vertex Express mode with the scoped key.
 */
export const generateText = async (prompt: string): Promise<string> => {
  if (import.meta.env?.DEV) {
    const resp = await fetch('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error || `Text service error ${resp.status}`);
    if (!data.text) throw new Error('No text generated.');
    return data.text as string;
  }

  const ai = new GoogleGenAI({ vertexai: true, apiKey: process.env.VERTEX_API_KEY });
  const result: any = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts: [{ text: prompt }] },
  });
  let text = '';
  for (const p of result?.candidates?.[0]?.content?.parts ?? []) {
    if (p.text) text += p.text;
  }
  if (!text.trim()) throw new Error('No text generated.');
  return text;
};

/**
 * Fetch a YouTube transcript (timestamped) via the dev proxy.
 * Returns null when unavailable (no captions, or a production build without the
 * proxy) so the caller can fall back to a manual transcript paste.
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

    // PROD (static build): call Supadata directly. Falls back to manual paste on failure.
    const apiKey = process.env.SUPADATA_API_KEY;
    if (!apiKey) return null;
    const r = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=false`, {
      headers: { 'x-api-key': apiKey },
    });
    if (!r.ok) return null;
    const data: any = await r.json().catch(() => ({}));
    const content = data?.content;
    const segments: TranscriptSegment[] = [];
    if (Array.isArray(content)) {
      for (const c of content) {
        const text = String(c?.text || '').replace(/\s+/g, ' ').trim();
        if (text) segments.push({ start: Math.floor((c?.offset ?? 0) / 1000), text });
      }
    } else if (typeof content === 'string' && content.trim()) {
      segments.push({ start: 0, text: content.trim() });
    }
    return segments.length ? segments : null;
  } catch {
    return null;
  }
};

// Compress raw pasted transcript / segments into a token-friendly timestamped block.
export const segmentsToText = (segments: TranscriptSegment[]): string =>
  segments.map(s => `[${formatTime(s.start)}] ${s.text}`).join('\n');
