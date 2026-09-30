import React, { useEffect, useState } from 'react';

// Home: AI person tracking, drawn (no real footage or people) — a wide two-person studio shot with a tracking
// box on each person; whoever is "talking" gets the red box, the 9:16 crop glides over to them, and the phone
// beside it shows that crop, the way the Shorts Maker's "Follow speaker" fit cuts a wide video.

const W = 1600, H = 900;
// each person's centre (x) in the wide frame, and the 9:16 crop's width in that frame
const PEOPLE = [{ x: 470, label: 'Speaker 1' }, { x: 1150, label: 'Speaker 2' }];
const CROP_W = Math.round(H * 9 / 16);

function Scene() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full block" aria-hidden="true">
      <defs>
        <linearGradient id="td-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1030" /><stop offset="1" stopColor="#1d2350" />
        </linearGradient>
        <linearGradient id="td-desk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a4b22" /><stop offset="1" stopColor="#3b1d0b" />
        </linearGradient>
        <radialGradient id="td-glow" cx="0.5" cy="0.2" r="0.7">
          <stop offset="0" stopColor="#ff3355" stopOpacity="0.25" /><stop offset="1" stopColor="#ff3355" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#td-sky)" />
      {/* a city skyline through the window */}
      {Array.from({ length: 26 }, (_, i) => {
        const bw = 40 + ((i * 37) % 50), bh = 140 + ((i * 83) % 260), bx = i * 64 - 20;
        return (
          <g key={i}>
            <rect x={bx} y={560 - bh} width={bw} height={bh} fill="#141a3d" />
            {Array.from({ length: Math.floor(bh / 34) }, (_, r) => (
              <rect key={r} x={bx + 8} y={560 - bh + 12 + r * 34} width={bw - 16} height={6} fill="#ffcf6b" opacity={(i + r) % 3 ? 0.35 : 0.8} />
            ))}
          </g>
        );
      })}
      <rect width={W} height={H} fill="url(#td-glow)" />
      <rect y={560} width={W} height={H - 560} fill="#15121b" />
      {/* guest: a sofa and a person */}
      <rect x={250} y={560} width={430} height={200} rx={40} fill="#3a4466" />
      <rect x={220} y={520} width={90} height={260} rx={36} fill="#465178" />
      <g>
        <path d="M330 900 C330 700 360 600 470 600 C580 600 610 700 610 900 Z" fill="#e0457b" />
        <rect x={447} y={540} width={46} height={70} rx={20} fill="#c98b6a" />
        <circle cx={470} cy={480} r={78} fill="#d89a78" />
        <path d="M388 470 C388 390 450 370 490 380 C550 392 562 440 556 480 C540 430 500 420 470 440 C430 420 400 440 388 470 Z" fill="#2b1a14" />
      </g>
      {/* host: behind a desk, with a mic */}
      <g>
        <path d="M1010 900 C1010 690 1040 590 1150 590 C1260 590 1290 690 1290 900 Z" fill="#1f2433" />
        <path d="M1130 600 L1150 700 L1170 600 Z" fill="#e8e8ee" />
        <rect x={1127} y={530} width={46} height={70} rx={20} fill="#b77a55" />
        <circle cx={1150} cy={470} r={76} fill="#c68660" />
        <path d="M1072 455 C1070 390 1120 370 1160 374 C1215 380 1232 420 1228 460 C1210 420 1170 410 1150 420 C1120 408 1086 425 1072 455 Z" fill="#3a2718" />
      </g>
      <rect x={880} y={640} width={720} height={260} fill="url(#td-desk)" />
      <rect x={880} y={640} width={720} height={14} fill="#f0a24a" opacity="0.8" />
      <rect x={955} y={520} width={10} height={120} fill="#555" />
      <rect x={935} y={470} width={50} height={80} rx={24} fill="#8d8d99" />
    </svg>
  );
}

function Corners({ className }: { className: string }) {
  const c = 'absolute w-3 h-3 sm:w-4 sm:h-4 bg-white rounded-[3px]';
  return (
    <div className={`absolute border-2 transition-colors duration-500 ${className}`}>
      <span className={`${c} -left-2 -top-2`} /><span className={`${c} -right-2 -top-2`} />
      <span className={`${c} -left-2 -bottom-2`} /><span className={`${c} -right-2 -bottom-2`} />
    </div>
  );
}

export default function TrackingDemo() {
  const [active, setActive] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setActive(a => (a + 1) % PEOPLE.length), 2600);
    return () => clearInterval(id);
  }, []);
  const cropLeft = PEOPLE[active].x - CROP_W / 2;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="grid md:grid-cols-[1fr_auto] gap-6 items-center">
      {/* the wide video, with a tracking box on each person and the 9:16 crop */}
      <div className="relative rounded-3xl overflow-hidden border border-thumb-line shadow-[0_20px_60px_-20px_rgba(255,51,85,0.35)] aspect-video">
        <Scene />
        {PEOPLE.map((p, i) => (
          <div key={p.label} className="absolute" style={{ left: pct(p.x - 170, W), top: pct(360, H), width: pct(340, W), height: pct(460, H) }}>
            <Corners className={`inset-0 ${i === active ? 'border-thumb-red' : 'border-white/70'}`} />
            <span className={`absolute -top-7 left-0 text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap transition-colors duration-500 ${
              i === active ? 'bg-thumb-red text-white' : 'bg-black/60 text-white/80'}`}>
              {i === active ? <><span className="inline-block w-1.5 h-1.5 rounded-full bg-white mr-1 animate-pulse align-middle" />Speaking</> : p.label}
            </span>
          </div>
        ))}
        {/* the 9:16 crop, gliding to whoever is talking; outside it dimmed */}
        <div className="absolute inset-y-0 transition-[left] duration-700 ease-in-out" style={{ left: pct(cropLeft, W), width: pct(CROP_W, W) }}>
          <div className="absolute inset-0 border-2 border-dashed border-thumb-green/90 rounded-md shadow-[0_0_0_2000px_rgba(0,0,0,0.45)]" />
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] sm:text-xs font-black bg-thumb-green text-black px-2 py-0.5 rounded-full">9:16</span>
        </div>
        <span className="absolute top-3 left-3 text-[10px] sm:text-xs font-bold bg-black/60 text-white px-2.5 py-1 rounded-full">Wide video · 16:9</span>
      </div>

      {/* the Short it becomes */}
      <div className="mx-auto w-[150px] sm:w-[180px]">
        <div className="relative rounded-[28px] border-[6px] border-[#222] bg-black overflow-hidden aspect-[9/16] shadow-2xl">
          <div className="absolute inset-y-0 transition-[left] duration-700 ease-in-out"
            style={{ width: `${(W / CROP_W) * 100}%`, left: `${-(cropLeft / CROP_W) * 100}%` }}>
            <Scene />
          </div>
          <span className="absolute top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold bg-black/60 text-white px-2 py-0.5 rounded-full whitespace-nowrap">Your Short</span>
        </div>
      </div>
    </div>
  );
}
