import React from 'react';
import type { HomeShort } from './homeShorts';

// A real Short playing (muted, looping) inside a phone frame.
const VideoPhone: React.FC<{ short: HomeShort; width: number; frame?: boolean }> = ({ short, width, frame = true }) => {
  const screen = (
    <video poster={short.poster} autoPlay muted loop playsInline preload="metadata" aria-label={short.title}
      className="block w-full object-cover bg-black" style={{ aspectRatio: '9 / 16', borderRadius: frame ? width * 0.12 : 18 }}>
      {short.webm && <source src={short.webm} type="video/webm" />}
      <source src={short.url} type="video/mp4" />
    </video>
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
