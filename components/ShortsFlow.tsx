import React from 'react';
import { DEFAULT_LOOK, PhonePreview, Studio } from './ShortsStylePicker';

// Home page: one long video → its best moments → three ready Shorts, animated on a loop (7 s).
const seg = (i: number, a: number) =>
  `@keyframes sfSeg${i}{0%,${a}%{opacity:.25;transform:scaleY(1)}${a + 2}%{opacity:1;transform:scaleY(1.7)}${a + 6}%,88%{opacity:1;transform:scaleY(1)}96%,100%{opacity:.25}}`;
const phone = (i: number, p: number) =>
  `@keyframes sfPhone${i}{0%,${p}%{opacity:.35;transform:translateY(10px) scale(.95)}${p + 6}%,88%{opacity:1;transform:translateY(0) scale(1)}96%,100%{opacity:.35;transform:translateY(10px) scale(.95)}}`
  + `@keyframes sfScore${i}{0%,${p + 5}%{transform:scale(0)}${p + 9}%{transform:scale(1.25)}${p + 12}%,88%{transform:scale(1)}96%,100%{transform:scale(0)}}`;
const BASE = '@keyframes sfHead{0%{left:0%}28%,100%{left:100%}}'
  + '@keyframes sfLine{0%,30%{stroke-dashoffset:260}46%,88%{stroke-dashoffset:0}96%,100%{stroke-dashoffset:260}}';

const SEGMENTS = [{ left: 12, width: 10, at: 6 }, { left: 44, width: 8, at: 15 }, { left: 74, width: 11, at: 23 }];
const PHONES = [
  { bg: 'white', caption: 'hormozi', score: 94, head: ['THE ONE', 'HABIT', 'THAT MADE ME RICH'] as [string, string, string], words: ['SAVE IT', 'FIRST'] as [string, string] },
  { bg: 'yellow', caption: 'red_box', score: 88, head: ['WHY MOST', 'STARTUPS', 'FAIL EARLY'] as [string, string, string], words: ['THEY NEVER', 'LISTEN'] as [string, string] },
  { bg: 'black_grid', caption: 'neon_green', score: 81, head: ['HE QUIT HIS', 'JOB', 'AT 25'] as [string, string, string], words: ['BEST DECISION', 'EVER'] as [string, string] },
];

const ShortsFlow: React.FC = () => {
  const css = BASE + SEGMENTS.map((sg, i) => seg(i, sg.at)).join('') + PHONES.map((_p, i) => phone(i, 42 + i * 6)).join('');
  const T = '7s';
  return (
    <div className="relative mx-auto max-w-3xl select-none" aria-hidden="true">
      <style>{css}</style>
      {/* the long video */}
      <div className="relative mx-auto w-[62%]">
        <div className="relative rounded-2xl overflow-hidden shadow-[0_20px_50px_-20px_rgba(0,0,0,.6)] ring-1 ring-black/10" style={{ aspectRatio: '16 / 9' }}>
          <Studio />
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] sm:text-[11px] font-bold">▶ 1:12:40 podcast</span>
        </div>
        {/* its timeline: the playhead runs, the best moments light up */}
        <div className="relative mt-2.5 h-2 rounded-full bg-thumb-line/80 overflow-visible">
          {SEGMENTS.map((s, i) => (
            <span key={i} className="absolute top-0 h-2 rounded-full bg-thumb-red" style={{ left: `${s.left}%`, width: `${s.width}%`, animation: `sfSeg${i} ${T} ease-out infinite` }} />
          ))}
          <span className="absolute -top-1 w-1 h-4 rounded bg-thumb-ink" style={{ animation: `sfHead ${T} linear infinite` }} />
        </div>
      </div>

      {/* arrows from each moment down to its Short */}
      <svg viewBox="0 0 600 90" className="w-full h-[56px] sm:h-[80px]" preserveAspectRatio="none">
        {[[177, 126], [293, 300], [410, 474]].map(([from, to], i) => (
          <path key={i} d={`M${from} 0 C${from} 45, ${to} 40, ${to} 84`} fill="none" stroke="#ff3355" strokeWidth={3} strokeLinecap="round"
            strokeDasharray="260" style={{ animation: `sfLine ${T} ease-out infinite`, animationDelay: `${i * 0.15}s` }} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>

      {/* the Shorts it makes */}
      <div className="flex justify-center gap-3 sm:gap-6">
        {PHONES.map((p, i) => (
          <div key={i} className="relative" style={{ animation: `sfPhone${i} ${T} ease-out infinite` }}>
            <PhonePreview look={{ ...DEFAULT_LOOK, bg: p.bg, caption: p.caption }} width={typeof window !== 'undefined' && window.innerWidth < 640 ? 100 : 150} head={p.head} words={p.words} />
            <span className="absolute -top-2 -right-2 z-40 inline-flex items-center gap-0.5 px-2 py-1 rounded-lg bg-thumb-red text-white text-[11px] sm:text-[13px] font-black shadow-lg"
              style={{ animation: `sfScore${i} ${T} ease-out infinite` }}>🔥 {p.score}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ShortsFlow;
