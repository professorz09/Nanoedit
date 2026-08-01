import { useState } from 'react';
import { isKnownLoaded, markKnownLoaded } from '../services/imageLoadCache';

const MAX_RETRIES = 4;

// A freshly-generated image can 404 for a moment right after upload (CDN edge
// hasn't picked it up yet) — retry a few times with backoff + a cache-busting
// query param before giving up, instead of permanently showing a broken image.
// Skips straight to "loaded" if this exact URL is already known-good from
// anywhere else in the app (see services/imageLoadCache.ts).
export function useImageLoad(url: string) {
  const [loaded, setLoaded] = useState(() => isKnownLoaded(url));
  const [errored, setErrored] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // data: URLs fail deterministically — retrying the identical string can't
  // help, so only retry real (Storage/CDN) URLs.
  const isRemote = !url.startsWith('data:');

  const onLoad = () => { markKnownLoaded(url); setLoaded(true); };
  const onError = () => {
    if (isRemote && attempt < MAX_RETRIES) {
      const delay = 500 * (attempt + 1);
      setTimeout(() => setAttempt(a => a + 1), delay);
    } else {
      setErrored(true);
    }
  };

  const src = loaded || !isRemote || attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;
  return { loaded, errored, src, onLoad, onError };
}
