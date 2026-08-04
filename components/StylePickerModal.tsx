import React from 'react';
import { I } from './ThumbIcons';

// A full-screen popup for picking one style reference from the shared style
// pool — same look as the "Add from Styles" popup in the image editor, reused
// here so Sketch mode and YouTube's Advanced section don't each need their
// own inline grid eating up vertical space.
const StylePickerModal: React.FC<{
  open: boolean;
  onClose: () => void;
  styleImages: string[];
  selected: string | null;
  onSelect: (src: string | null) => void;
  hint?: string;
}> = ({ open, onClose, styleImages, selected, onSelect, hint }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="thumb-glass border border-thumb-line rounded-2xl p-5 w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-base font-black text-thumb-ink">Pick a style</h3>
            {hint && <p className="text-xs text-thumb-sub mt-0.5">{hint}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center"><I.X className="w-4 h-4" /></button>
        </div>
        {selected && (
          <button type="button" onClick={() => { onSelect(null); onClose(); }} className="self-start text-[11px] font-bold text-thumb-red hover:underline mb-2">
            Clear selection
          </button>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto no-scrollbar pr-1 mt-2">
          {styleImages.map((src, i) => {
            const active = selected === src;
            return (
              <button
                key={src + i}
                type="button"
                onClick={() => { onSelect(active ? null : src); onClose(); }}
                className={`relative aspect-video rounded-xl overflow-hidden border-2 bg-black/40 transition-colors ${active ? 'border-thumb-red shadow-md' : 'border-thumb-line hover:border-thumb-red/50'}`}
              >
                <img src={src} alt={`Style ${i + 1}`} loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                {active && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-thumb-red text-white flex items-center justify-center text-[11px] font-bold">✓</div>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StylePickerModal;
