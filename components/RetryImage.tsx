import React, { useCallback, useEffect, useRef } from 'react';
import { useImageLoad } from '../hooks/useImageLoad';

// A drop-in <img> with retry-on-transient-404 (same policy as
// LoadedThumb/ResultThumb — a freshly-generated image can 404 for a moment
// right after upload while the CDN edge catches up). Pass `key={url}` where
// this is rendered so switching to a different url resets the retry
// sequence cleanly instead of carrying over stale attempt/error state.
const RetryImage: React.FC<
  Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { url: string; onFail?: () => void }
> = ({ url, onFail, onLoad, onError, ...rest }) => {
  const { errored, src, onLoad: markLoaded, onError: retryOnError, imgRef } = useImageLoad(url);
  const localRef = useRef<HTMLImageElement | null>(null);
  // useImageLoad reads img.complete off its own ref; keep both pointed at the
  // same element (LoadedThumb passes imgRef straight through — this component
  // never did, so that check was always looking at null here).
  const setRef = useCallback((el: HTMLImageElement | null) => {
    localRef.current = el;
    imgRef.current = el;
  }, [imgRef]);

  useEffect(() => { if (errored) onFail?.(); }, [errored]);

  // An image already in the browser cache fires its native `load` the moment
  // `src` is set — which can happen before React attaches the handler below,
  // so the event is simply lost and onLoad NEVER runs. That's invisible for a
  // plain <img>, but callers hang real work off onLoad (sizing the brush
  // canvas, clearing a loading state), and the fullscreen viewer's image is
  // always cached — its thumbnail was just on screen. Replay the missed event
  // once per url from img.complete.
  useEffect(() => {
    const img = localRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      markLoaded();
      onLoad?.({ target: img, currentTarget: img } as unknown as React.SyntheticEvent<HTMLImageElement>);
    }
    // onLoad identity changes every render for inline arrow callers; keying on
    // url only is deliberate — this must fire once per image, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <img
      ref={setRef}
      src={src}
      onLoad={(e) => { markLoaded(); onLoad?.(e); }}
      onError={(e) => { retryOnError(); onError?.(e); }}
      {...rest}
    />
  );
};

export default RetryImage;
