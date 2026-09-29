import React, { useEffect, useState } from 'react';

// Home heading: the fixed promise, then what's inside it, one thing at a time (slides up every 2.2 s).
const WORDS = ['AI B-rolls', 'PNG stickers', 'animated captions', 'bulk clipping', 'viral scores', 'full automation'];

const HeroRotator: React.FC = () => {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(n => (n + 1) % WORDS.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-center">
      <style>{`@keyframes hrIn{0%{transform:translateY(60%);opacity:0;filter:blur(4px)}100%{transform:translateY(0);opacity:1;filter:blur(0)}}
@keyframes hrUnder{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}`}</style>
      <h1 className="text-[2.1rem] sm:text-[3.2rem] lg:text-[4rem] font-black leading-[1.02] tracking-[-0.03em] text-thumb-ink">
        Podcasts into viral Shorts,
        <br />
        with{' '}
        <span className="relative inline-block align-bottom">
          <span key={i} className="inline-block text-thumb-red" style={{ animation: 'hrIn .5s cubic-bezier(.2,.8,.2,1) both' }}>{WORDS[i]}</span>
          <span key={`u${i}`} className="absolute left-0 right-0 -bottom-1 h-[6px] rounded-full bg-thumb-red/25 origin-left" style={{ animation: 'hrUnder .6s .15s ease-out both' }} />
        </span>
      </h1>
      <p className="mt-5 text-thumb-sub text-[15px] sm:text-[18px] max-w-2xl mx-auto leading-relaxed">
        Bulk clipping for <b className="text-thumb-ink">podcasters</b> and <b className="text-thumb-ink">solo creators</b> —
        ready for <b className="text-thumb-ink">TikTok</b>, <b className="text-thumb-ink">Instagram Reels</b> and <b className="text-thumb-ink">YouTube Shorts</b>.
        It’s all here.
      </p>
    </div>
  );
};

export default HeroRotator;
