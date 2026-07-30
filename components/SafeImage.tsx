import React from 'react';

// An <img> that swaps in a clean placeholder instead of the browser's broken
// "?" glyph when the source fails to load (e.g. a Storage URL that expired, got
// deleted by the rolling cap, or is momentarily unreachable). Mirrors the
// existing fallback patterns in EditorView (full-view) and ThumbnailStudio
// (ResultThumb), but reusable across every generated-image render site.
//
// Props are passed straight through to the <img>. Extra props:
//   fallbackClassName — sizing/shape classes for the placeholder box (defaults
//                       to the img's className so it occupies the same space).
//   fallbackLabel     — text shown under the icon (default "Image unavailable").
const SafeImage = ({
  src,
  alt = '',
  className = '',
  fallbackClassName,
  fallbackLabel = 'Image unavailable',
  onError,
  onLoad,
  onClick,
  loading,
  style,
  ...rest
}: any) => {
  const [errored, setErrored] = React.useState(false);

  // Reset when the source changes so a reused element retries a new URL.
  React.useEffect(() => {
    setErrored(false);
  }, [src]);

  if (!src || errored) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1.5 bg-thumb-card text-thumb-sub select-none ${fallbackClassName ?? className}`}
        style={style}
        onClick={onClick}
        role="img"
        aria-label={fallbackLabel}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
          <path d="M3 3l18 18" opacity="0.55" />
        </svg>
        <span className="text-[11px] font-medium leading-none">{fallbackLabel}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      onClick={onClick}
      onLoad={onLoad}
      onError={(e: any) => {
        setErrored(true);
        if (onError) onError(e);
      }}
      {...rest}
    />
  );
};

export default SafeImage;
