import React, { useEffect, useRef, useState } from 'react';

// Home: an illustrative chart — the hours manual editing takes as the Shorts pile up, against PodcastFlux,
// and the gap between them (the time you get back). Draws itself when it scrolls into view.
const W = 720, H = 400, L = 60, R = 600, TOP = 50, BASE = 310;
const X = [1, 5, 10, 20];
const xAt = (n: number) => L + ((n - 1) / 19) * (R - L);
const yAt = (hours: number) => BASE - (hours / 26) * (BASE - TOP);
// manual: ~1 h a Short (find the moment, cut, crop, captions, title), a little worse as it piles up
const manual = (n: number) => n * (1 + n / 80);
const ours = (n: number) => 0.15 + n * 0.02; // minutes of picking and downloading

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

      <svg viewBox={`0 0 ${W} ${H}`} className="relative w-full mt-4" role="img" aria-label="Manual editing hours rise with every Short; with PodcastFlux they stay near zero">
        <defs>
          <pattern id="tgHatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" stroke="#ff3355" strokeOpacity=".18" strokeWidth="2" />
          </pattern>
          <linearGradient id="tgFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff3355" stopOpacity=".16" /><stop offset="1" stopColor="#ff3355" stopOpacity=".03" /></linearGradient>
        </defs>
        {/* the gap = the time you get back */}
        <path d={gap} fill="url(#tgFill)" style={{ opacity: 0, animation: t('tgFade .8s 1.1s ease-out forwards') }} />
        <path d={gap} fill="url(#tgHatch)" style={{ opacity: 0, animation: t('tgFade .8s 1.1s ease-out forwards') }} />
        {/* axis */}
        <line x1={L} y1={BASE + 30} x2={R} y2={BASE + 30} stroke="currentColor" className="text-thumb-line" strokeWidth="1.5" />
        {X.map(n => (
          <g key={n}>
            <line x1={xAt(n)} y1={BASE + 30} x2={xAt(n)} y2={BASE + 36} stroke="currentColor" className="text-thumb-line" />
            <text x={xAt(n)} y={BASE + 56} textAnchor="middle" className="text-thumb-sub" fill="currentColor" fontSize="19">{n} {n === 1 ? 'Short' : 'Shorts'}</text>
          </g>
        ))}
        {/* manual editing */}
        <path d={top} fill="none" stroke="#ff3355" strokeWidth="4" strokeLinecap="round" strokeDasharray="1400" strokeDashoffset={on ? 0 : 1400} style={{ animation: t('tgDraw 1.6s ease-out both') }} />
        {/* with PodcastFlux */}
        <path d={bottom} fill="none" stroke="currentColor" className="text-thumb-ink" strokeWidth="3" strokeLinecap="round" strokeDasharray="1400" strokeDashoffset={on ? 0 : 1400} style={{ animation: t('tgDraw 1.6s .2s ease-out both') }} />
        {/* points on the manual line */}
        {X.map((n, k) => (
          <g key={n} style={{ opacity: 0, animation: t(`tgFade .4s ${0.35 + k * 0.3}s ease-out forwards`) }}>
            <circle cx={xAt(n)} cy={yAt(manual(n))} r="6" fill="#ff3355" />
            <text x={xAt(n) + (n === 20 ? -12 : 10)} y={yAt(manual(n)) - 12} textAnchor={n === 20 ? 'end' : 'start'} className="text-thumb-sub" fill="currentColor" fontSize="19">
              ~{Math.round(manual(n))} {Math.round(manual(n)) === 1 ? 'hour' : 'hours'}
            </text>
          </g>
        ))}
        <circle cx={xAt(20)} cy={yAt(manual(20))} r="12" fill="#ff3355" style={{ opacity: 0, animation: t('tgFade .4s 1.3s forwards, tgPulse 2s 1.7s ease-in-out infinite') }} />
        {/* where each line ends up */}
        <g style={{ opacity: 0, animation: t('tgFade .5s 1.6s forwards') }}>
          <rect x={R + 14} y={yAt(manual(20)) - 20} width="104" height="40" rx="20" fill="#ff3355" />
          <text x={R + 66} y={yAt(manual(20)) + 7} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="800">≈ 3 days</text>
          <rect x={R + 14} y={yAt(ours(20)) - 20} width="104" height="40" rx="20" fill="#16a34a" />
          <text x={R + 66} y={yAt(ours(20)) + 7} textAnchor="middle" fontSize="18" fontWeight="800" fill="#fff">≈ 10 min</text>
        </g>
        {/* labels */}
        <text x={L} y={yAt(9)} fill="#ff3355" fontSize="21" fontWeight="800">editing by hand</text>
        <text x={L} y={BASE + 14} className="text-thumb-ink" fill="currentColor" fontSize="20" fontWeight="800">with PodcastFlux — minutes</text>
        <g style={{ opacity: 0, animation: t('tgFade .6s 1.5s forwards') }}>
          <line x1={xAt(15)} y1={yAt(ours(15)) - 6} x2={xAt(15)} y2={yAt(manual(15)) + 10} stroke="#ff3355" strokeWidth="3" markerEnd="url(#tgArrow)" />
          <text x={xAt(15) - 12} y={(yAt(ours(15)) + yAt(manual(15))) / 2} textAnchor="end" fill="#ff3355" fontSize="21" fontWeight="800">the time</text>
          <text x={xAt(15) - 12} y={(yAt(ours(15)) + yAt(manual(15))) / 2 + 20} textAnchor="end" fill="#ff3355" fontSize="21" fontWeight="800">you get back</text>
        </g>
        <defs><marker id="tgArrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#ff3355" /></marker></defs>
      </svg>
    </div>
  );
};

export default TimeGraph;
