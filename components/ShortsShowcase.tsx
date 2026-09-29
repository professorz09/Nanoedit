import React from 'react';
import { DEFAULT_LOOK, PhonePreview } from './ShortsStylePicker';
import { HOME_SHORTS } from './homeShorts';
import VideoPhone from './VideoPhone';

// Home page: "post anywhere" — the platforms, then a moving strip of real Shorts (components/homeShorts.ts);
// example looks only while there are none.
const REAL = HOME_SHORTS;

type Ex = { bg: string; caption: string; fx: string; head: [string, string, string]; words: [string, string]; label: string };
const EXAMPLES: Ex[] = [
  { bg: 'white', caption: 'hormozi', fx: 'marker', head: ['THE ONE', 'HABIT', 'THAT MADE ME RICH'], words: ['SAVE IT', 'FIRST'], label: 'Studio · White' },
  { bg: 'yellow', caption: 'red_box', fx: 'counter', head: ['HOW I MADE', '$10K', 'IN 30 DAYS'], words: ['EVERY SINGLE', 'MONTH'], label: 'Studio · Yellow' },
  { bg: 'black_grid', caption: 'neon_green', fx: 'burst', head: ['HE QUIT HIS', 'JOB', 'AT 25'], words: ['BEST DECISION', 'EVER'], label: 'Studio · Black grid' },
  { bg: 'wall_red', caption: 'sticker', fx: 'zoom_punch', head: ['NOBODY TELLS', 'YOU', 'THIS'], words: ['THE HARD', 'TRUTH'], label: 'Studio · Red wall' },
  { bg: 'blue', caption: 'chat_bubble', fx: 'card_move', head: ['WHY MOST', 'STARTUPS', 'FAIL EARLY'], words: ['THEY NEVER', 'LISTEN'], label: 'Studio · Blue' },
  { bg: 'glass', caption: 'glass', fx: 'push_in', head: ['THE MORNING', 'ROUTINE', 'THAT WORKS'], words: ['WAKE UP', 'EARLY'], label: 'Studio · Glass' },
  { bg: 'wall_emerald', caption: 'gold', fx: 'money_stack', head: ['HOW RICH', 'PEOPLE', 'THINK'], words: ['MONEY', 'WORKS'], label: 'Studio · Emerald' },
  { bg: 'pink', caption: 'highlighter', fx: 'scribble', head: ['SIGNS', 'SHE', 'LIKES YOU'], words: ['SHE ALWAYS', 'REPLIES'], label: 'Studio · Pink' },
];

const Icon: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <span title={label} aria-label={label} className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white shadow-[0_6px_18px_-6px_rgba(0,0,0,.25)] ring-1 ring-black/5 flex items-center justify-center">
    <svg viewBox="0 0 24 24" className="w-6 h-6 sm:w-7 sm:h-7">{children}</svg>
  </span>
);
const PLATFORMS = (
  <>
    <Icon label="TikTok"><path fill="#111" d="M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3.1v12.4a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1V9.7a5.8 5.8 0 1 0 4.9 5.7V9.1a7.4 7.4 0 0 0 4.3 1.4V7.4a4.3 4.3 0 0 1-3.3-1.6Z" /></Icon>
    <Icon label="YouTube Shorts"><path fill="#FF0000" d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8Z" /><path fill="#fff" d="m9.8 15.1 5.8-3.1-5.8-3.1v6.2Z" /></Icon>
    <Icon label="Instagram Reels"><defs><linearGradient id="ssIg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#FEDA75" /><stop offset=".35" stopColor="#FA7E1E" /><stop offset=".65" stopColor="#D62976" /><stop offset="1" stopColor="#4F5BD5" /></linearGradient></defs><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="url(#ssIg)" strokeWidth="2.2" /><circle cx="12" cy="12" r="4" fill="none" stroke="url(#ssIg)" strokeWidth="2.2" /><circle cx="17.3" cy="6.7" r="1.3" fill="url(#ssIg)" /></Icon>
    <Icon label="Facebook"><circle cx="12" cy="12" r="10" fill="#1877F2" /><path fill="#fff" d="M13.4 21.9v-7h2.3l.4-2.8h-2.7v-1.8c0-.8.2-1.3 1.4-1.3h1.4V6.5a19 19 0 0 0-2.1-.1c-2.1 0-3.5 1.3-3.5 3.6v2.1H8.3v2.8h2.3v7Z" /></Icon>
    <Icon label="X"><path fill="#111" d="M17.8 3h3.1l-6.8 7.7 8 10.3h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" /></Icon>
    <Icon label="LinkedIn"><rect x="2" y="2" width="20" height="20" rx="3" fill="#0A66C2" /><path fill="#fff" d="M6.9 9.5h2.4V18H6.9V9.5Zm1.2-3.9a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Zm2.9 3.9h2.3v1.2c.3-.6 1.1-1.3 2.4-1.3 2.5 0 3 1.6 3 3.8V18h-2.4v-4.2c0-1 0-2.3-1.4-2.3s-1.6 1.1-1.6 2.2V18H11V9.5Z" /></Icon>
  </>
);

const ShortsShowcase: React.FC<{ onCta: () => void }> = ({ onCta }) => {
  const small = typeof window !== 'undefined' && window.innerWidth < 640;
  const w = small ? 150 : 210;
  const cards = REAL.length
    ? REAL.map(r => (
      <figure key={r.url} className="shrink-0" style={{ width: w }}>
        <VideoPhone short={r} width={w} frame={false} />
        <figcaption className="mt-2.5 text-[13px] font-bold text-thumb-ink leading-snug line-clamp-2 text-left">{r.title}</figcaption>
      </figure>
    ))
    : EXAMPLES.map(e => (
      <figure key={e.label} className="shrink-0" style={{ width: w }}>
        <PhonePreview look={{ ...DEFAULT_LOOK, bg: e.bg, caption: e.caption }} fxOnly={e.fx} width={w} head={e.head} words={e.words} frame={false} />
        <figcaption className="mt-2.5 text-[13px] font-bold text-thumb-ink">{e.label}</figcaption>
      </figure>
    ));
  const dur = `${Math.max(REAL.length, 5) * 6}s`;

  return (
    <div className="text-center">
      <style>{'@keyframes ssMarquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}.ss-track:hover{animation-play-state:paused}'}</style>
      <span className="inline-block px-4 py-1.5 rounded-full border border-thumb-red/30 text-thumb-red text-[12px] font-black uppercase tracking-[0.12em]">Social-ready Shorts with AI</span>
      <h2 className="mt-4 text-[1.7rem] sm:text-[2.6rem] font-black leading-[1.08] tracking-[-0.02em] text-thumb-ink max-w-2xl mx-auto">
        One link. Shorts ready for every platform.
      </h2>
      <div className="mt-6 flex flex-wrap justify-center gap-3 sm:gap-4">{PLATFORMS}</div>

      <div className="relative -mx-5 mt-10 overflow-hidden">
        <div className="ss-track flex gap-4 sm:gap-6 w-max px-4" style={{ animation: `ssMarquee ${dur} linear infinite` }}>
          {cards}
          {/* the same again, so the loop has no seam */}
          {React.Children.map(cards, c => React.cloneElement(c as React.ReactElement, { key: `${(c as React.ReactElement).key}-2` }))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 sm:w-24 bg-gradient-to-r from-thumb-bg to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 sm:w-24 bg-gradient-to-l from-thumb-bg to-transparent" />
      </div>
      {!REAL.length && <p className="mt-4 text-[12px] text-thumb-sub">Example looks — every Short is made from your own video.</p>}

      <button type="button" onClick={onCta} className="thumb-btn mt-8 px-8 h-14 rounded-2xl text-white font-black text-[17px]">
        Get Shorts for free
      </button>
    </div>
  );
};

export default ShortsShowcase;
