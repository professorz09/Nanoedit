import React, { useEffect, useState } from 'react';
import { I } from './ThumbIcons';

// The thumbnail maker's empty results panel (user-requested: not a blank box — show how a YouTube video becomes
// thumbnails). Clean, like a product demo: the video on top, the link typed into a bar under it, a cursor taps
// "Get thumbnails", the button works for a beat, then three finished thumbnails pop out below, one after another.
// Each round uses the next showcase pictures. With reduced motion it just shows the finished state.

const LINKS = ['youtube.com/watch?v=Qx7nL2pRk9A', 'youtu.be/8fKd2LmWq0s', 'youtube.com/watch?v=Zp4Tt6YcVbE'];
// ms from the start of a round: typing → cursor moves in → tap → making → thumbnails out → hold
const T_TYPED = 1100, T_TAP = 1900, T_OUT = 2900, T_ROUND = 7400;

const ThumbDemo: React.FC<{ images: string[] }> = ({ images }) => {
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [round, setRound] = useState(0);
  const [t, setT] = useState(reduced ? T_OUT + 1500 : 0);

  useEffect(() => {
    if (reduced) return;
    const started = Date.now();
    const id = setInterval(() => {
      const el = Date.now() - started;
      setT(el % T_ROUND);
      setRound(Math.floor(el / T_ROUND));
    }, 60);
    return () => clearInterval(id);
  }, [reduced]);

  if (!images.length) return null;
  const pic = (k: number) => images[(round * 3 + k) % images.length];
  const link = LINKS[round % LINKS.length];
  const typed = link.slice(0, Math.max(0, Math.min(link.length, Math.floor((t / T_TYPED) * link.length))));
  const cursorIn = t >= T_TYPED - 200;
  const tapping = t >= T_TAP && t < T_TAP + 180;
  const making = t >= T_TAP && t < T_OUT;
  const out = (k: number) => t >= T_OUT + k * 260;

  return (
    <div className="rounded-[28px] border border-white/[0.07] bg-[radial-gradient(120%_70%_at_50%_0%,rgba(255,45,82,0.10),transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] px-4 py-7 sm:px-8 sm:py-10 min-h-[320px] lg:min-h-[460px] flex flex-col items-center overflow-hidden" aria-label="How it works: a YouTube link becomes thumbnails">
      {/* the YouTube video it starts from */}
      <div className="relative w-32 sm:w-40 aspect-video rounded-xl overflow-hidden ring-1 ring-white/15 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.9)]">
        <img key={`p${round}`} src={pic(0)} alt="" className="absolute inset-0 w-full h-full object-cover brightness-[0.55] saturate-[0.8]" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-9 h-6 rounded-md bg-[#ff0000] flex items-center justify-center"><I.Play className="w-3.5 h-3.5 text-white ml-0.5" /></span>
        </span>
        <span className="absolute bottom-1 right-1 px-1 rounded bg-black/80 text-white text-[9px] font-bold tabular-nums">18:24</span>
      </div>
      <span className="w-px h-5 sm:h-6 bg-gradient-to-b from-white/25 to-white/5" />

      {/* the link bar, the button and the cursor */}
      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-2 h-12 pl-3.5 pr-1.5 rounded-2xl bg-[#101014] border border-white/[0.09] shadow-[0_12px_30px_-14px_rgba(0,0,0,0.9)]">
          <I.Youtube className="w-5 h-5 text-[#ff0000] shrink-0" />
          <span className="flex-1 min-w-0 text-[12.5px] sm:text-[13px] text-thumb-ink/85 font-medium truncate">
            {typed || <span className="text-thumb-sub/60">Paste a YouTube link</span>}
            {t < T_TYPED && <span className="inline-block w-[2px] h-4 -mb-0.5 ml-0.5 bg-thumb-red animate-pulse" />}
          </span>
          <span className={`thumb-btn shrink-0 h-9 px-3.5 rounded-xl text-white text-[12px] font-black inline-flex items-center gap-1.5 transition-transform duration-150 ${tapping ? 'scale-90' : ''}`}>
            {making ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <I.Wand className="w-3.5 h-3.5" />}
            {making ? 'Making…' : 'Get thumbnails'}
          </span>
        </div>
        {/* the pointer: glides in toward the button, taps it, then drifts away */}
        <svg viewBox="0 0 24 24" aria-hidden
          className="absolute w-6 h-6 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] transition-all duration-700 ease-out pointer-events-none"
          style={{
            right: cursorIn && t < T_OUT + 600 ? 34 : -30,
            top: cursorIn && t < T_OUT + 600 ? 26 : 70,
            opacity: cursorIn && t < T_OUT + 900 ? 1 : 0,
            transform: tapping ? 'scale(0.82)' : 'none',
          }}>
          <path d="M5 3l13 7-5.6 1.6L10 17z" fill="#fff" stroke="#111" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </div>

      {/* the thumbnails it makes */}
      <span className={`w-px h-5 sm:h-6 transition-colors duration-500 ${t >= T_OUT ? 'bg-gradient-to-b from-thumb-red/60 to-white/5' : 'bg-white/5'}`} />
      <div className="grid grid-cols-3 gap-2 sm:gap-3 w-full max-w-lg">
        {[0, 1, 2].map(k => (
          <div key={`${round}-${k}`}
            className={`relative aspect-video rounded-lg sm:rounded-xl overflow-hidden ring-1 ring-white/15 bg-white/[0.03] transition-all duration-500 ease-out ${out(k) ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 -translate-y-3 scale-90'}`}
            style={{ transform: out(k) ? `rotate(${(k - 1) * 2.5}deg)` : undefined }}>
            <img src={pic(k)} alt="" className="absolute inset-0 w-full h-full object-cover" />
            {out(k) && <span className="absolute inset-0 thumb-demo-shine" />}
          </div>
        ))}
      </div>

      <div className="mt-auto pt-8 text-center">
        <p className="text-[15px] font-black text-thumb-ink">Paste a link. Get thumbnails like these.</p>
        <p className="text-[12.5px] text-thumb-sub mt-1">Up to 4K · 16:9 or 9:16 · your results show up right here.</p>
      </div>
    </div>
  );
};

export default ThumbDemo;
