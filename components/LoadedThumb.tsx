import React from 'react';
import { useImageLoad } from '../hooks/useImageLoad';

// Skeleton-while-loading + retry-on-error thumbnail, for small grid tiles
// (generated results list, style picker) where a full "preview unavailable"
// fallback would be overkill. Renders inside a `relative` parent the caller
// already provides.
const LoadedThumb: React.FC<{
  src: string;
  alt: string;
  className: string;
  onClick?: () => void;
}> = ({ src, alt, className, onClick }) => {
  const { loaded, errored, src: displaySrc, onLoad, onError, imgRef } = useImageLoad(src);
  return (
    <>
      {!loaded && !errored && <div className="thumb-skeleton absolute inset-0" aria-hidden />}
      <img ref={imgRef} src={displaySrc} alt={alt} loading="lazy" className={className} onClick={onClick} onLoad={onLoad} onError={onError} />
    </>
  );
};

export default LoadedThumb;
