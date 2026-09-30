import React, { useEffect, useState } from 'react';
import { I } from './ThumbIcons';

// The thumbnail maker's empty results panel (user-requested: not a blank box — show how a YouTube video
// becomes thumbnails, and at what quality). A loop: a link is pasted, the video plays blurred while the AI
// reads it, then two finished thumbnails pop in sharp, marked 4K. Each round uses the next showcase pictures.
// With reduced motion it just shows the finished state.

const LINKS = ['youtube.com/watch?v=Qx7nL2pRk9A', 'youtu.be/8fKd2LmWq0s', 'youtube.com/watch?v=Zp4Tt6YcVbE'];
const STEPS = ['Reading the video', 'Finding the hook', 'Designing'];
// ms from the start of a round: link typed → reading → thumbnails in → hold
const T_READ = 1600, T_DONE = 4200, T_ROUND = 7600;

const ThumbDemo: React.FC<{ images: string[] }> = ({ images }) => {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [round, setRound] = useState(0);
  const [t, setT] = useState(reduced ? T_DONE : 0);

  useEffect(() => {
    if (reduced) return;
    const started = Date.now();
    const id = setInterval(() => {
      const el = Date.now() - started;
      setT(el % T_ROUND);
      setRound(Math.floor(el / T_ROUND));
    }, 80);
    return () => clearInterval(id);
  }, [reduced]);

  if (!images.length) return null;
  const pic = (k: number) => images[(round * 2 + k) % images.length];
  const link = LINKS[round % LINKS.length];
  const typed = link.slice(0, Math.max(0, Math.min(link.length, Math.floor((t / 900) * link.length))));
  const reading = t >= T_READ && t < T_DONE;
  const done = t >= T_DONE;
  const step = Math.min(STEPS.length - 1, Math.floor(((t - T_READ) / (T_DONE - T_READ)) * STEPS.length));

  return (
    <div className="rounded-[28px] border border-white/[0.07] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-4 sm:p-6 min-h-[280px] lg:min-h-[440px] flex flex-col gap-4 overflow-hidden" aria-label="How it works: a YouTube link becomes thumbnails">
      {/* 1 · the link */}
      <div className="flex items-center gap-2.5 h-12 px-4 rounded-2xl bg-black/50 border border-white/[0.08]">
        <I.Youtube className="w-5 h-5 text-thumb-red shrink-0" />
        <span className="text-[13px] sm:text-sm text-thumb-ink/90 font-medium truncate">
          {typed}
          {t < 1000 && <span className="inline-block w-[2px] h-4 -mb-0.5 ml-0.5 bg-thumb-red animate-pulse" />}
        </span>
        {t >= 1000 && <span className="ml-auto shrink-0 text-[10px] font-black uppercase tracking-wider text-thumb-green">Link ✓</span>}
      </div>

      {/* 2 · the video, read by the AI */}
      <div className="relative aspect-video rounded-2xl overflow-hidden bg-black border border-white/[0.06]">
        <img key={`v${round}`} src={pic(0)} alt="" className={`absolute inset-0 w-full h-full object-cover scale-110 transition-all duration-700 ${done ? 'blur-[10px] opacity-30' : 'blur-[6px] opacity-60'}`} />
        <div className="absolute inset-0 bg-black/30" />
        {!done && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="w-12 h-12 rounded-full bg-thumb-red/90 flex items-center justify-center shadow-[0_0_30px_-4px_rgba(255,51,85,0.8)]"><I.Play className="w-5 h-5 text-white ml-0.5" /></span>
          </span>
        )}
        {reading && <span className="absolute inset-y-0 left-0 w-[14%] finding-scan bg-gradient-to-r from-transparent via-thumb-red/45 to-transparent" />}
        {/* the video's progress bar */}
        <span className="absolute left-3 right-3 bottom-3 h-1 rounded-full bg-white/20 overflow-hidden">
          <span className="block h-full bg-thumb-red transition-[width] duration-100" style={{ width: `${Math.min(100, (t / T_DONE) * 100)}%` }} />
        </span>
        {reading && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/15 text-white text-[11px] font-bold">
            <span className="w-3 h-3 border-2 border-thumb-red border-t-transparent rounded-full animate-spin" /> {STEPS[step]}…
          </span>
        )}
        {/* 3 · the finished thumbnails, sharp, over the video */}
        {done && (
          <div className="absolute inset-0 p-3 grid grid-cols-2 gap-2.5 items-center">
            {[0, 1].map(k => (
              <div key={`${round}-${k}`} className="thumb-demo-pop relative aspect-video rounded-xl overflow-hidden ring-1 ring-white/20 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.9)]" style={{ animationDelay: `${k * 160}ms` }}>
                <img src={pic(k)} alt="" className="absolute inset-0 w-full h-full object-cover" />
                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/75 text-white text-[9px] font-black tracking-wide">4K</span>
                <span className="absolute inset-0 thumb-demo-shine" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* the steps, as chips */}
      <div className="flex flex-wrap gap-1.5">
        {['Paste a link', ...STEPS, 'Thumbnails ready'].map((s, i) => {
          const at = t < T_READ ? 0 : done ? 4 : step + 1;
          const on = i <= at;
          return (
            <span key={s} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors duration-300 ${on ? 'bg-thumb-red/15 border-thumb-red/40 text-white' : 'bg-white/[0.03] border-white/[0.07] text-thumb-sub/70'}`}>
              {i < at || (done && i === 4) ? '✓' : i === at ? <span className="w-1.5 h-1.5 rounded-full bg-thumb-red animate-pulse" /> : null} {s}
            </span>
          );
        })}
      </div>

      <div className="mt-auto text-center">
        <p className="text-[15px] font-black text-thumb-ink">From a YouTube video to thumbnails like these</p>
        <p className="text-[12.5px] text-thumb-sub mt-1">Up to 4K · 16:9 or 9:16 · your results show up right here.</p>
      </div>
    </div>
  );
};

export default ThumbDemo;
