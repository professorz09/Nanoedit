// YouTube URL/metadata helpers shared across the studio (generation), Chapter
// Maker, and Title Generator. Kept as a plain service rather than living
// inside a UI component, so those features don't need to import out of a page.

const FETCH_TIMEOUT_MS = 8000;

// fetch() with a hard timeout — a stalled request (bad network, a hung CDN
// edge) would otherwise leave the "youtube" generation flow waiting forever.
// Times out as a rejection so every caller's existing try/catch → null
// fallback keeps working unchanged.
const fetchWithTimeout = (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
};

// Extract the 11-char YouTube video id from most URL shapes
export const extractYouTubeId = (url: string): string | null => {
  const m = url.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};

// Convert a bundled asset URL (template preview) into a base64 data-URL so it can
// be sent to the model as a real style reference.
export const urlToBase64 = async (url: string): Promise<string | null> => {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

// Fetch a YouTube video's title (best-effort, CORS-friendly). noembed first, then
// YouTube's own oembed as a fallback. Returns null when neither is reachable.
export const fetchYouTubeTitle = async (id: string): Promise<string | null> => {
  const endpoints = [
    `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      const title = typeof data?.title === 'string' ? data.title.trim() : '';
      if (title) return title;
    } catch {
      /* try next */
    }
  }
  return null;
};

// Fetch an existing YouTube thumbnail as a base64 reference (best quality available)
export const fetchYouTubeThumb = async (id: string): Promise<string | null> => {
  const qualities = ['maxresdefault', 'sddefault', 'hqdefault'];
  for (const q of qualities) {
    try {
      const res = await fetchWithTimeout(`https://i.ytimg.com/vi/${id}/${q}.jpg`);
      if (!res.ok) continue;
      const blob = await res.blob();
      // hqdefault always exists (120x90 grey placeholder is ~1KB); skip tiny/empty ones
      if (blob.size < 3000 && q !== 'hqdefault') continue;
      return await new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
      });
    } catch {
      /* try next quality */
    }
  }
  return null;
};
