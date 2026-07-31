import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// A pill selector (Format / Variations / Quality, ...) with a highlight that
// SLIDES between options instead of snapping. Plain className-swapping (the
// old approach) can't transition smoothly because the selected state's
// background is a gradient, and CSS can't animate between two different
// gradients — it just jumps, which reads as glitchy. Measuring the active
// button's real position and sliding one shared highlight behind it fixes
// that regardless of how many options there are or how wide each one is.
const SegmentedControl = <T extends string>({
  options, value, onChange, className = '',
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) => {
  const groupRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);

  const measure = () => {
    const group = groupRef.current;
    const btn = btnRefs.current[value];
    if (!group || !btn) return;
    const g = group.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    setRect({ left: b.left - g.left, width: b.width });
  };

  useLayoutEffect(() => { measure(); }, [value, options.length]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [value, options.length]);

  return (
    <div ref={groupRef} className={`relative flex gap-1 p-1 bg-thumb-soft border border-thumb-line rounded-xl ${className}`}>
      {rect && (
        <span
          className="thumb-liquid absolute inset-y-0 rounded-lg transition-[transform,width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-none"
          style={{ transform: `translateX(${rect.left}px)`, width: rect.width }}
        />
      )}
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          ref={el => { btnRefs.current[opt.value] = el; }}
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`relative z-10 flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-bold transition-colors duration-200 ${value === opt.value ? 'text-white' : 'text-thumb-sub hover:text-thumb-ink'}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
};

export default SegmentedControl;
