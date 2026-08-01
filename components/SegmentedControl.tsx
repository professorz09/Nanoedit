import React from 'react';

// A pill selector (Format / Variations / Quality, ...). Every option is an
// equal-width flex-1 cell at all times, so nothing ever changes size on
// selection — the highlight is just a per-button opacity cross-fade behind
// the label, not a JS-measured box sliding to match a button's real
// position/width. That measurement approach (getBoundingClientRect + a
// ResizeObserver safety net) still had a real race: on first paint, or right
// after the active webfont swaps in, the measured rect could be briefly
// stale — which showed up as "nothing selected" for a moment, or a highlight
// that didn't quite line up with its own label. An opacity fade has nothing
// to measure, so there's nothing to race.
const SegmentedControl = <T extends string>({
  options, value, onChange, className = '',
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) => {
  return (
    <div className={`flex gap-1 p-1 bg-thumb-soft border border-thumb-line rounded-xl ${className}`}>
      {options.map(opt => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`relative flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-bold transition-colors duration-150 ${active ? 'text-white' : 'text-thumb-sub hover:text-thumb-ink'}`}
          >
            <span aria-hidden className={`absolute inset-0 rounded-lg thumb-liquid transition-opacity duration-150 pointer-events-none ${active ? 'opacity-100' : 'opacity-0'}`} />
            <span className="relative z-10 flex items-center justify-center gap-1.5">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default SegmentedControl;
