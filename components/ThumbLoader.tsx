import React from 'react';

// user-requested ("thumbnail banne tak ek clean, professional animation"): while a thumbnail is being made, its
// card shows the thumbnail taking shape — a colour wash, the person, the headline, a sticker — built in the order of
// the generation steps, a light sweeping across, and one slim progress bar with the current step underneath.
const ThumbLoader: React.FC<{ seconds: number; steps: string[] }> = ({ seconds, steps }) => {
  const step = Math.min(steps.length - 1, Math.floor(seconds / 4));
  // eases toward 95% over ~30 s — never "done" until the picture really arrives
  const pct = Math.round(95 * (1 - Math.exp(-seconds / 11)));
  return (
    <div className="tl-root absolute inset-0 overflow-hidden rounded-2xl" role="status" aria-label={steps[step]}>
      <div className="tl-wash absolute inset-0" />
      {/* the layout taking shape */}
      <div className="absolute inset-0 p-[7%] flex items-center gap-[5%]">
        <div className="flex-1 space-y-[5%]">
          <span className="tl-bar block h-[11%] min-h-[9px] w-[92%] rounded-md bg-white/85" style={{ animationDelay: '1.4s' }} />
          <span className="tl-bar block h-[11%] min-h-[9px] w-[70%] rounded-md bg-[#ff2d52]" style={{ animationDelay: '1.8s' }} />
          <span className="tl-bar block h-[11%] min-h-[9px] w-[52%] rounded-md bg-white/60" style={{ animationDelay: '2.2s' }} />
        </div>
        <div className="tl-person relative w-[38%] aspect-[3/4] self-end -mb-[7%]" style={{ animationDelay: '.7s' }}>
          <span className="absolute left-1/2 -translate-x-1/2 top-[6%] w-[46%] aspect-square rounded-full bg-white/20" />
          <span className="absolute left-1/2 -translate-x-1/2 bottom-0 w-[92%] h-[52%] rounded-t-[48%] bg-white/20" />
        </div>
      </div>
      <span className="tl-sticker absolute top-[9%] right-[8%] px-2 py-0.5 rounded-md bg-[#ffd400] text-[9px] sm:text-[10px] font-black text-black rotate-6" style={{ animationDelay: '2.7s' }}>NEW!</span>
      <span className="tl-sweep absolute inset-y-0 -left-1/3 w-1/3" />
      {/* progress */}
      <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5 pt-6 bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center justify-between text-[11px] font-semibold text-white/90">
          <span key={step} className="tl-step">{steps[step]}…</span>
          <span className="tabular-nums text-white/60">{seconds.toFixed(0)}s</span>
        </div>
        <div className="mt-1.5 h-[3px] rounded-full bg-white/15 overflow-hidden">
          <div className="h-full rounded-full bg-[#ff2d52] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
};

export default ThumbLoader;
