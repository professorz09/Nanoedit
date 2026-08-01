import React, { useEffect } from 'react';
import { useImageLoad } from '../hooks/useImageLoad';

// A drop-in <img> with retry-on-transient-404 (same policy as
// LoadedThumb/ResultThumb — a freshly-generated image can 404 for a moment
// right after upload while the CDN edge catches up). Pass `key={url}` where
// this is rendered so switching to a different url resets the retry
// sequence cleanly instead of carrying over stale attempt/error state.
const RetryImage: React.FC<
  Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { url: string; onFail?: () => void }
> = ({ url, onFail, onLoad, onError, ...rest }) => {
  const { errored, src, onLoad: markLoaded, onError: retryOnError } = useImageLoad(url);
  useEffect(() => { if (errored) onFail?.(); }, [errored]);
  return (
    <img
      src={src}
      onLoad={(e) => { markLoaded(); onLoad?.(e); }}
      onError={(e) => { retryOnError(); onError?.(e); }}
      {...rest}
    />
  );
};

export default RetryImage;
