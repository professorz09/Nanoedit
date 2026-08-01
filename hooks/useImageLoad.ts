import { useEffect, useRef, useState } from 'react';
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
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Attach this to the consumer's <img> — lets the effect below check
  // img.complete for the race condition described there.
  const imgRef = useRef<HTMLImageElement | null>(null);

  // A component instance can be reused for a different url without
  // remounting (e.g. no `key` on the caller) — reset retry state so a
  // previous image's error/attempt count doesn't leak onto the new one.
  useEffect(() => {
    setErrored(false);
    setAttempt(0);
    // A fully browser-cached image fires its native `load` event as soon as
    // the <img src> is set — which can happen before React finishes
    // attaching our onLoad listener for this render. That leaves `loaded`
    // stuck at false forever even though the pixels are already painted
    // (skeleton overlays never clear; opacity-gated consumers like
    // ResultThumb stay invisible). img.complete after mount/url-change
    // catches that missed event.
    const already = isKnownLoaded(url) || !!(imgRef.current?.complete && (imgRef.current?.naturalWidth ?? 0) > 0);
    if (already) markKnownLoaded(url);
    setLoaded(already);
    return () => { if (retryTimer.current) clearTimeout(retryTimer.current); };
  }, [url]);

  // data: URLs fail deterministically — retrying the identical string can't
  // help, so only retry real (Storage/CDN) URLs.
  const isRemote = !url.startsWith('data:');

  const onLoad = () => { markKnownLoaded(url); setLoaded(true); };
  const onError = () => {
    if (isRemote && attempt < MAX_RETRIES) {
      const delay = 500 * (attempt + 1);
      retryTimer.current = setTimeout(() => setAttempt(a => a + 1), delay);
    } else {
      setErrored(true);
    }
  };

  const src = loaded || !isRemote || attempt === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}`;
  return { loaded, errored, src, onLoad, onError, imgRef };
}
