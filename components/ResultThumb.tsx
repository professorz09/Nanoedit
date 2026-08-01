import React from 'react';
import { GeneratedImage } from '../types';
import { I } from './ThumbIcons';
import { useImageLoad } from '../hooks/useImageLoad';

// A single result card with its own skeleton-while-loading state (shared,
// cross-canvas cache + retry logic lives in hooks/useImageLoad).
// The image only fetches when near the viewport (loading="lazy"), so a long
// history stays cheap — the browser (and Supabase Storage/CDN) isn't hit for
// off-screen thumbnails.
const ResultThumb: React.FC<{
  img: GeneratedImage;
  onView: (url: string) => void;
  onDownload: (url: string) => void;
  onOpenEditor: (url: string) => void;
  onPreview: (url: string) => void;
  onDelete: (id: string) => void;
}> = ({ img, onView, onDownload, onOpenEditor, onPreview, onDelete }) => {
  const { loaded, errored, src, onLoad, onError } = useImageLoad(img.url);
  const portrait = img.aspect === '9:16' || img.aspect === '4:5' || img.aspect === '3:4';

  return (
    <div className="group relative rounded-2xl overflow-hidden border border-thumb-line bg-thumb-card shadow-sm animate-fade-in-up flex flex-col">
      <div className={`relative overflow-hidden bg-thumb-soft mx-auto w-full ${portrait ? 'aspect-[9/16] max-w-[240px]' : 'aspect-video'}`}>
        {!loaded && !errored && <div className="absolute inset-0 thumb-skeleton" aria-hidden />}
        {errored ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-thumb-soft text-thumb-sub text-xs">
            <I.Image className="w-6 h-6 opacity-50" />
            <span>Preview unavailable</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onView(img.url)}
            aria-label="View full size"
            className="block w-full h-full p-0 border-0 bg-transparent cursor-pointer"
          >
            <img
              src={src}
              alt={img.prompt}
              loading="lazy"
              decoding="async"
              onLoad={onLoad}
              onError={onError}
              className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </button>
        )}
      </div>
      {/* Clean action bar (always visible, works on touch) — single delete */}
      <div className="flex gap-1.5 p-2 bg-thumb-card">
        <button onClick={() => onDownload(img.url)} title="Download" className="flex-1 py-2 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-ink text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-thumb-line/60 transition-colors"><I.Download className="w-4 h-4" /> Save</button>
        <button onClick={() => onOpenEditor(img.url)} title="Edit in Canvas" className="flex-1 py-2 rounded-lg thumb-btn text-white text-xs font-bold flex items-center justify-center gap-1.5"><I.Edit className="w-4 h-4" /> Edit</button>
        <button onClick={() => onPreview(img.url)} title="YouTube feed preview" aria-label="YouTube feed preview" className="w-9 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center transition-colors"><I.Tv className="w-4 h-4" /></button>
        <button onClick={() => onDelete(img.id)} title="Delete" aria-label="Delete" className="w-9 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-red hover:border-thumb-red/40 flex items-center justify-center transition-colors"><I.Trash className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

export default ResultThumb;
