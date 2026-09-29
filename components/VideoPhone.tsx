import React from 'react';
import type { HomeShort } from './homeShorts';

// A real Short playing (muted, looping) inside a phone frame.
// user-reported: on a fresh load the phones showed up empty — every Short on the page (a dozen videos) started
// downloading at once and their small posters waited behind them. Now the poster is a plain image, shown at once,
// and the video is only fetched when the phone comes near the screen; it fades in over the poster once it plays.
const VideoPhone: React.FC<{ short: HomeShort; width: number; frame?: boolean }> = ({ short, width, frame = true }) => {
  const box = React.useRef<HTMLDivElement>(null);
  const [near, setNear] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const screen = (
    <div ref={box} className="relative w-full overflow-hidden bg-thumb-soft" style={{ aspectRatio: '9 / 16', borderRadius: frame ? width * 0.12 : 18 }}>
      {short.poster && <img src={short.poster} alt="" decoding="async" className="absolute inset-0 w-full h-full object-cover" />}
      {near && (
        <video autoPlay muted loop playsInline preload="auto" aria-label={short.title} onPlaying={() => setPlaying(true)}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${playing ? 'opacity-100' : 'opacity-0'}`}>
          {short.webm && <source src={short.webm} type="video/webm" />}
          <source src={short.url} type="video/mp4" />
        </video>
      )}
    </div>
  );
  return (
    <div style={{ width }} className="shrink-0">
      {frame
        ? <div className="bg-[#111] shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)]" style={{ padding: width * 0.035, borderRadius: width * 0.155 }}>{screen}</div>
        : <div className="shadow-[0_18px_40px_-16px_rgba(0,0,0,.45)] rounded-[18px]">{screen}</div>}
    </div>
  );
};

export default VideoPhone;
