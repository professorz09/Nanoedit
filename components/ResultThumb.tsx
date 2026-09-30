import React, { useState } from 'react';
import { GeneratedImage } from '../types';
import { I } from './ThumbIcons';
import { useImageLoad } from '../hooks/useImageLoad';
import { shareImage } from '../services/shareService';

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
  onChangeFace: (url: string) => void;
  onDelete: (id: string) => void;
  /** see it in a real YouTube feed (the Feed test page) */
  onFeedTest?: (url: string) => void;
}> = ({ img, onView, onDownload, onOpenEditor, onChangeFace, onDelete, onFeedTest }) => {
  const { loaded, errored, src, onLoad, onError, imgRef } = useImageLoad(img.url);
  const portrait = img.aspect === '9:16' || img.aspect === '4:5' || img.aspect === '3:4';
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');
  const handleShare = async () => {
    const result = await shareImage(img.url);
    if (result === 'copied') {
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 1800);
    }
  };

  return (
    <div className="group relative rounded-2xl overflow-hidden border border-white/[0.07] bg-[#131317] shadow-sm animate-fade-in-up flex flex-col">
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
              ref={imgRef}
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
      {/* Action bar (always visible, works on touch): the two main actions as buttons, the rest as icons */}
      <div className="flex gap-1.5 p-2">
        <button onClick={() => onDownload(img.url)} title="Download" className="flex-1 h-10 rounded-xl bg-white text-[#0b0b0d] text-[13px] font-bold flex items-center justify-center gap-1.5 hover:bg-white/90 transition-colors"><I.Download className="w-4 h-4" /> Save</button>
        <button onClick={() => onOpenEditor(img.url)} title="Edit in the editor" className="flex-1 h-10 rounded-xl thumb-btn text-white text-[13px] font-bold flex items-center justify-center gap-1.5"><I.Edit className="w-4 h-4" /> Edit</button>
        {onFeedTest && (
          <button onClick={() => onFeedTest(img.url)} title="See it in a YouTube feed" aria-label="See it in a YouTube feed" className="result-icon"><I.Tv className="w-4 h-4" /></button>
        )}
        <button onClick={() => onChangeFace(img.url)} title="Change face" aria-label="Change face" className="result-icon"><I.FaceSwap className="w-4 h-4" /></button>
        <button onClick={handleShare} title={shareState === 'copied' ? 'Link copied!' : 'Share'} aria-label="Share" className={`result-icon ${shareState === 'copied' ? '!text-thumb-green !border-thumb-green/40' : ''}`}>
          {shareState === 'copied' ? <I.Check className="w-4 h-4" /> : <I.Share className="w-4 h-4" />}
        </button>
        <button onClick={() => onDelete(img.id)} title="Delete" aria-label="Delete" className="result-icon hover:!text-thumb-red"><I.Trash className="w-4 h-4" /></button>
      </div>
    </div>
  );
};

export default ResultThumb;
