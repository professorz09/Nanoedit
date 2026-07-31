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
  // One silent, cache-busted retry before showing the fallback — a CDN cold-start
  // or momentary network blip shouldn't trip the "unavailable" placeholder (and,
  // via onError, prune a still-live thumbnail). Only a genuine 404 fails twice.
  const [attempt, setAttempt] = React.useState(0);

  // Reset when the source changes so a reused element retries a new URL.
  React.useEffect(() => {
    setErrored(false);
    setAttempt(0);
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

  const displaySrc = attempt === 0 ? src : `${src}${String(src).includes('?') ? '&' : '?'}_r=${attempt}`;

  return (
    <img
      src={displaySrc}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      onClick={onClick}
      onLoad={onLoad}
      onError={(e: any) => {
        if (attempt < 1) { setAttempt(1); return; }
        setErrored(true);
        if (onError) onError(e);
      }}
      {...rest}
    />
  );
};

export default SafeImage;
