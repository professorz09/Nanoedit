import React, { useEffect, useRef, useState } from 'react';

// Home: an illustrative chart — the hours manual editing takes as the Shorts pile up, against PodcastFlux,
// and the gap between them (the time you get back). Draws itself when it scrolls into view.
const W = 720, H = 360, L = 30, R = 560, TOP = 40, BASE = 290;
const X = [1, 5, 10, 20];
const xAt = (n: number) => L + ((n - 1) / 19) * (R - L);
const yAt = (hours: number) => BASE - (hours / 26) * (BASE - TOP);
// manual: ~1 h a Short (find the moment, cut, crop, captions, title), a little worse as it piles up
const manual = (n: number) => n * (1 + n / 80);
const ours = (n: number) => 0.15 + n * 0.02; // minutes of picking and downloading
const GREEN = '#16a34a', RED = '#ff3355';

const path = (f: (n: number) => number) => {
  const pts = Array.from({ length: 39 }, (_, k) => 1 + k * 0.5);
  return pts.map((n, k) => `${k ? 'L' : 'M'}${xAt(n).toFixed(1)} ${yAt(f(n)).toFixed(1)}`).join(' ');
};

const TimeGraph: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const top = path(manual), bottom = path(ours);
  const gap = `${top} L${xAt(20)} ${yAt(ours(20))} ${bottom.replace(/^M/, 'L').split(' L').reverse().join(' L')} Z`;
  const t = (d: string) => (on ? d : 'none');

  return (
    <div ref={ref} className="relative thumb-glass rounded-[28px] p-4 sm:p-8 overflow-hidden">
      <style>{`@keyframes tgDraw{from{stroke-dashoffset:1400}to{stroke-dashoffset:0}}
@keyframes tgFade{from{opacity:0}to{opacity:1}}
@keyframes tgPulse{0%,100%{r:10;opacity:.35}50%{r:16;opacity:.12}}`}</style>
      <div className="absolute inset-0 pointer-events-none opacity-60" style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '22px 22px', color: 'rgba(120,120,140,.25)' }} />
      <div className="relative flex flex-col-reverse sm:flex-row items-start justify-between gap-3">
        <div>
          <p className="text-thumb-red font-black tracking-widest text-[12px] uppercase">Why it matters</p>
          <h3 className="text-[22px] sm:text-[30px] font-black text-thumb-ink leading-tight mt-1">Every Short by hand costs you an hour.</h3>
          <p className="text-thumb-sub text-[14px] sm:text-[15px] mt-1.5 max-w-xl">Finding the moment, cutting, cropping, captions, a title. Do twenty and your week is gone — or paste one link.</p>
        </div>
        <span className="shrink-0 px-3 py-1 rounded-full border border-thumb-line text-[11px] font-mono tracking-widest text-thumb-sub">ILLUSTRATIVE</span>
      </div>

      {/* legend — kept off the chart so nothing overlaps */}
      <div className="relative mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-bold">
        <span className="inline-flex items-center gap-2 text-thumb-ink"><span className="w-5 h-[3px] rounded" style={{ background: RED }} /> Editing by hand</span>
        <span className="inline-flex items-center gap-2 text-thumb-ink"><span className="w-5 h-[3px] rounded" style={{ background: GREEN }} /> With PodcastFlux</span>
        <span className="inline-flex items-center gap-2 text-thumb-ink"><span className="w-4 h-4 rounded" style={{ background: 'repeating-linear-gradient(45deg, rgba(255,51,85,.28) 0 2px, rgba(255,51,85,.08) 2px 6px)' }} /> The time you get back</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="relative w-full mt-3" role="img" aria-label="Manual editing hours rise with every Short; with PodcastFlux they stay near zero">
        <defs>
          <pattern id="tgHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke={RED} strokeOpacity=".2" strokeWidth="2" />
          </pattern>
          <linearGradient id="tgFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={RED} stopOpacity=".18" /><stop offset="1" stopColor={RED} stopOpacity=".03" /></linearGradient>
        </defs>
        {/* faint grid */}
        {[5, 10, 15, 20, 25].map(h => (
          <line key={h} x1={L} x2={R} y1={yAt(h)} y2={yAt(h)} stroke="currentColor" className="text-thumb-line" strokeDasharray="3 6" />
        ))}
        <path d={gap} fill="url(#tgFill)" style={{ opacity: 0, animation: t('tgFade .8s 1.1s ease-out forwards') }} />
        <path d={gap} fill="url(#tgHatch)" style={{ opacity: 0, animation: t('tgFade .8s 1.1s ease-out forwards') }} />
        {/* x axis */}
        <line x1={L} y1={BASE + 18} x2={R} y2={BASE + 18} stroke="currentColor" className="text-thumb-line" strokeWidth="1.5" />
        {X.map((n, k) => (
          <text key={n} x={xAt(n)} y={BASE + 46} textAnchor={k === 0 ? 'start' : k === X.length - 1 ? 'end' : 'middle'}
            className="text-thumb-sub" fill="currentColor" fontSize="18">{n === 20 ? '20 Shorts' : n}</text>
        ))}
        {/* the two lines */}
        <path d={top} fill="none" stroke={RED} strokeWidth="4" strokeLinecap="round" strokeDasharray="1400" strokeDashoffset={on ? 0 : 1400} style={{ animation: t('tgDraw 1.6s ease-out both') }} />
        <path d={bottom} fill="none" stroke={GREEN} strokeWidth="4" strokeLinecap="round" strokeDasharray="1400" strokeDashoffset={on ? 0 : 1400} style={{ animation: t('tgDraw 1.6s .2s ease-out both') }} />
        {/* the hours, as small pills above each point */}
        {X.map((n, k) => {
          const label = `${Math.round(manual(n))}h`;
          const x = xAt(n), y = yAt(manual(n));
          const pw = 16 + label.length * 11;
          const px = Math.min(Math.max(x - pw / 2, L), R - pw);
          return (
            <g key={n} style={{ opacity: 0, animation: t(`tgFade .4s ${0.35 + k * 0.3}s ease-out forwards`) }}>
              <circle cx={x} cy={y} r="6" fill={RED} stroke="#fff" strokeWidth="2" />
              <rect x={px} y={y - 44} width={pw} height="28" rx="14" fill="#fff" stroke={RED} strokeOpacity=".35" />
              <text x={px + pw / 2} y={y - 24} textAnchor="middle" fill={RED} fontSize="16" fontWeight="800">{label}</text>
            </g>
          );
        })}
        <circle cx={xAt(20)} cy={yAt(manual(20))} r="12" fill={RED} style={{ opacity: 0, animation: t('tgFade .4s 1.3s forwards, tgPulse 2s 1.7s ease-in-out infinite') }} />
        {/* where each line ends up */}
        <g style={{ opacity: 0, animation: t('tgFade .5s 1.6s forwards') }}>
          <rect x={R + 22} y={yAt(manual(20)) - 20} width="130" height="40" rx="20" fill={RED} />
          <text x={R + 87} y={yAt(manual(20)) + 7} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="800">≈ 3 work days</text>
          <rect x={R + 22} y={yAt(ours(20)) - 20} width="130" height="40" rx="20" fill={GREEN} />
          <text x={R + 87} y={yAt(ours(20)) + 7} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="800">≈ 10 minutes</text>
          <line x1={xAt(15)} y1={yAt(ours(15)) - 8} x2={xAt(15)} y2={yAt(manual(15)) + 14} stroke={RED} strokeWidth="2.5" strokeDasharray="4 5" markerEnd="url(#tgArrow)" />
        </g>
        <defs><marker id="tgArrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill={RED} /></marker></defs>
      </svg>
    </div>
  );
};

export default TimeGraph;
