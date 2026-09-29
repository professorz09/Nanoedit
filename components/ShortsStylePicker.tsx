import React from 'react';
import { createPortal } from 'react-dom';

// The Shorts Maker's look picker: style, background, subtitles, effects, fit and length — each as a small visual
// card — and a phone preview that shows the picked combination. The keys match the render server
// (Movievideomaker's shortsbot/maker.py and pipeline/shorts_split.py).

export interface ShortsLook {
  style: string;        // split (Studio) | classic | boxed
  bg: string;           // a Studio background
  caption: string;      // Studio: a caption look / auto / off; Classic & Boxed: auto | animated | simple | off
  fxMode: 'auto' | 'pick';
  fx: string[];
  sfx: boolean;
  fit: string;          // full | zoom | track (Classic & Boxed)
  length: string;
}

export const DEFAULT_LOOK: ShortsLook = {
  style: 'split', bg: 'white', caption: 'auto', fxMode: 'auto', fx: [], sfx: true, fit: 'full', length: 'auto',
};

// what the server gets for this look
export const lookToRequest = (l: ShortsLook) => {
  const studio = l.style === 'split';
  return {
    length: l.length,
    style: l.style,
    subtitles: studio ? (l.caption === 'off' ? 'off' : 'auto') : l.caption,
    bg: l.bg,
    caption_look: studio && l.caption !== 'off' ? l.caption : 'auto',
    fx: (l.fxMode === 'auto' ? 'auto' : l.fx) as string[] | 'auto',
    sfx: l.sfx,
    fit: studio ? 'full' : l.fit,
  };
};

const STYLES = [
  { id: 'split', label: 'Studio', note: 'Video in a card, animated words, effects' },
  { id: 'classic', label: 'Classic', note: 'Title bar on top, full video' },
  { id: 'boxed', label: 'Boxed', note: 'Dark page, video in a rounded box' },
];

type Bg = { id: string; label: string; css: React.CSSProperties; dark?: boolean; tag?: string };
const grid = (line: string, base: string): React.CSSProperties => ({
  backgroundColor: base,
  backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
  backgroundSize: '12px 12px',
});
const wall = (c: string): React.CSSProperties => ({
  backgroundColor: c,
  backgroundImage: `radial-gradient(circle at 30% 20%, rgba(255,255,255,.16), transparent 55%), repeating-linear-gradient(45deg, rgba(0,0,0,.10) 0 2px, transparent 2px 5px)`,
});
const BGS: Bg[] = [
  { id: 'ai', label: 'Auto', tag: 'AI', css: { background: 'conic-gradient(from 200deg, #FDE047, #F9A8D4, #93C5FD, #86EFAC, #FDE047)' } },
  { id: 'random', label: 'Mix', tag: '🎲', css: { background: 'linear-gradient(135deg,#fff 0 25%,#FDE047 25% 50%,#0B0B0F 50% 75%,#A3111B 75%)' } },
  { id: 'white', label: 'White', css: { background: '#FFFFFF' } },
  { id: 'white_grid', label: 'White grid', css: grid('rgba(0,0,0,.08)', '#FFFFFF') },
  { id: 'yellow', label: 'Yellow', css: { background: '#FDE047' } },
  { id: 'blue', label: 'Blue', css: { background: '#93C5FD' } },
  { id: 'green', label: 'Green', css: { background: '#86EFAC' } },
  { id: 'pink', label: 'Pink', css: { background: '#F9A8D4' } },
  { id: 'glass', label: 'Glass', css: { ...grid('rgba(255,255,255,.35)', '#D6CFE6'), backgroundImage: `radial-gradient(circle at 50% 45%, rgba(255,255,255,.9), transparent 55%), linear-gradient(rgba(255,255,255,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.35) 1px, transparent 1px)`, backgroundSize: '100% 100%, 12px 12px, 12px 12px' } },
  { id: 'black', label: 'Black', dark: true, css: { background: '#0B0B0F' } },
  { id: 'black_grid', label: 'Black grid', dark: true, css: grid('rgba(255,255,255,.09)', '#0B0B0F') },
  { id: 'wall_red', label: 'Red wall', dark: true, css: wall('#A3111B') },
  { id: 'wall_maroon', label: 'Maroon', dark: true, css: wall('#5B0F1A') },
  { id: 'wall_navy', label: 'Navy', dark: true, css: wall('#0F1E4A') },
  { id: 'wall_emerald', label: 'Emerald', dark: true, css: wall('#064E3B') },
  { id: 'wall_purple', label: 'Purple', dark: true, css: wall('#3B0764') },
  { id: 'wall_teal', label: 'Teal', dark: true, css: wall('#0B4F5C') },
  { id: 'wall_charcoal', label: 'Charcoal', dark: true, css: wall('#1C1C1E') },
];

// a caption look: how the key word and the other words are drawn
type Cap = { id: string; label: string; key: React.CSSProperties; soft?: React.CSSProperties; wrap?: React.CSSProperties; font?: string };
const IMPACT = '"Anton", "Bebas Neue", Impact, "Arial Black", sans-serif';
const ROUND = '"Fredoka", "Poppins", "Arial Rounded MT Bold", sans-serif';
const SERIF = '"DM Serif Display", Georgia, serif';
const MONO = '"Courier New", ui-monospace, monospace';
const HAND = '"Caveat", "Comic Sans MS", cursive';
const CAPS: Cap[] = [
  { id: 'auto', label: 'Auto mix', font: IMPACT, key: { color: '#EF4444' } },
  { id: 'hormozi', label: 'Hormozi', font: ROUND, key: { color: '#FACC15', WebkitTextStroke: '1px #111', textShadow: '0 2px 0 #111' } },
  { id: 'mrbeast', label: 'MrBeast', font: IMPACT, key: { color: '#22C55E', WebkitTextStroke: '1px #111', textShadow: '0 2px 0 #111' } },
  { id: 'neon_green', label: 'Neon glow', font: IMPACT, key: { color: '#4ADE80', textShadow: '0 0 6px #39FF14, 0 0 14px #39FF14' } },
  { id: 'glass', label: 'Liquid glass', font: ROUND, key: { color: '#111', background: 'rgba(255,255,255,.55)', border: '1px solid rgba(255,255,255,.9)', borderRadius: 10, padding: '0 6px', backdropFilter: 'blur(4px)', boxShadow: '0 4px 14px rgba(0,0,0,.15)' } },
  { id: 'red_box', label: 'Red box', font: IMPACT, key: { color: '#fff', background: '#DC2626', padding: '0 6px', borderRadius: 4 } },
  { id: 'black_box', label: 'Black blocks', font: IMPACT, key: { color: '#fff', background: '#111', padding: '0 6px' }, soft: { color: '#fff', background: '#111', padding: '0 4px' } },
  { id: 'karaoke', label: 'Karaoke fill', font: IMPACT, key: { background: 'linear-gradient(90deg,#FACC15 55%,#fff 55%)', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextStroke: '1px #111' } },
  { id: 'highlighter', label: 'Highlighter', font: IMPACT, key: { color: '#111', background: 'linear-gradient(100deg,transparent 4%,#FDE047 4% 96%,transparent 96%)', padding: '0 4px', transform: 'rotate(-2deg)', display: 'inline-block' } },
  { id: 'comic', label: 'Comic', font: ROUND, key: { color: '#FACC15', WebkitTextStroke: '1px #111', textShadow: '2px 2px 0 #EC4899', transform: 'rotate(-3deg)', display: 'inline-block' } },
  { id: 'fire', label: 'Fire', font: IMPACT, key: { background: 'linear-gradient(0deg,#DC2626,#F97316,#FACC15)', WebkitBackgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 4px rgba(249,115,22,.7))' } },
  { id: 'ice', label: 'Ice', font: IMPACT, key: { background: 'linear-gradient(0deg,#0EA5E9,#A5F3FC,#fff)', WebkitBackgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 4px rgba(14,165,233,.7))' } },
  { id: 'gold', label: 'Luxury gold', font: SERIF, key: { background: 'linear-gradient(180deg,#FDE68A,#CA8A04,#FDE68A)', WebkitBackgroundClip: 'text', color: 'transparent' } },
  { id: 'typewriter', label: 'Typewriter', font: MONO, key: { color: '#111', background: '#fff', padding: '0 4px', fontWeight: 700 }, soft: { fontFamily: MONO } },
  { id: 'sticker', label: 'Sticker', font: ROUND, key: { color: '#111', background: '#fff', border: '2px solid #111', borderRadius: 8, padding: '0 6px', transform: 'rotate(-4deg)', display: 'inline-block', boxShadow: '2px 3px 0 #111' } },
  { id: 'chat_bubble', label: 'Chat bubble', font: ROUND, key: { color: '#fff', background: '#3B82F6', borderRadius: 14, padding: '0 8px' }, soft: { color: '#fff', background: '#3B82F6', borderRadius: 14, padding: '0 6px' } },
  { id: 'sticky_note', label: 'Sticky note', font: HAND, key: { color: '#DC2626' }, wrap: { background: '#FDE68A', padding: '4px 8px', transform: 'rotate(-2deg)', boxShadow: '0 4px 10px rgba(0,0,0,.18)' } },
  { id: 'news_bar', label: 'News bar', font: IMPACT, key: { color: '#EF4444' }, wrap: { background: '#111', padding: '3px 8px' }, soft: { color: '#fff' } },
  { id: 'pop_art', label: 'Pop art', font: IMPACT, key: { color: '#FACC15', WebkitTextStroke: '1px #111', textShadow: '2px 2px 0 #EC4899' } },
  { id: 'rgb_split', label: 'RGB glitch', font: IMPACT, key: { color: '#fff', textShadow: '-2px 0 #EF4444, 2px 0 #3B82F6' } },
  { id: 'minimal', label: 'Minimal', font: '"Inter", system-ui, sans-serif', key: { fontWeight: 600, letterSpacing: 0 }, soft: { fontWeight: 400 } },
  { id: 'poster_words', label: 'Poster words', font: IMPACT, key: { fontSize: '1.5em', lineHeight: 1 } },
  { id: 'off', label: 'No subtitles', key: {} },
];
const SIMPLE_CAPS: Cap[] = [
  { id: 'auto', label: 'Auto mix', font: IMPACT, key: { color: '#FACC15', WebkitTextStroke: '1px #111' }, soft: { color: '#fff', WebkitTextStroke: '1px #111' } },
  { id: 'animated', label: 'Animated', font: IMPACT, key: { color: '#22C55E', WebkitTextStroke: '1px #111' }, soft: { color: '#fff', WebkitTextStroke: '1px #111' } },
  { id: 'simple', label: 'Simple', font: '"Arial Black", sans-serif', key: { color: '#fff', WebkitTextStroke: '1px #111' }, soft: { color: '#fff', WebkitTextStroke: '1px #111' } },
  { id: 'off', label: 'No subtitles', key: {} },
];

export const FX: { id: string; icon: string; label: string; note: string }[] = [
  { id: 'hook_freeze', icon: '🖼️', label: 'Thumbnail cover', note: 'A clean cover as the first frame' },
  { id: 'card_drop', icon: '⬇️', label: 'Card drop', note: 'Headline first, the video drops in' },
  { id: 'card_move', icon: '🔀', label: 'Card swap', note: 'The video hops to the other side' },
  { id: 'push_in', icon: '🔍', label: 'Slow push-in', note: 'A slow zoom the whole time' },
  { id: 'zoom_punch', icon: '💥', label: 'Zoom punch', note: 'Punch-in on the big moments' },
  { id: 'cascade', icon: '🪜', label: 'Word cascade', note: 'Each word unfolds as it is said' },
  { id: 'marker', icon: '🖍️', label: 'Marker swipe', note: 'Highlighter behind the key word' },
  { id: 'scribble', icon: '⭕', label: 'Hand circle', note: 'A pen circle round the key word' },
  { id: 'counter', icon: '🔢', label: 'Number counter', note: 'Spoken numbers count up big' },
  { id: 'scramble', icon: '🎰', label: 'Number scramble', note: 'Digits spin, then land' },
  { id: 'money_stack', icon: '💵', label: 'Money stack', note: 'Notes pile up beside money' },
  { id: 'facts', icon: '📊', label: 'Fact cards', note: 'Numbers as a mini infographic' },
  { id: 'stickers', icon: '🎨', label: 'AI stickers', note: 'A drawn sticker of what is said' },
  { id: 'burst', icon: '🎉', label: 'Burst', note: 'Confetti on key moments' },
  { id: 'audio_react', icon: '🎚️', label: 'Audio reactive', note: 'Glow that moves with the voice' },
  { id: 'progress', icon: '⏳', label: 'Progress bar', note: 'A bar that fills as it plays' },
];

const FITS = [
  { id: 'full', label: 'Full video', note: 'Nothing cut off' },
  { id: 'zoom', label: 'Zoomed', note: 'Bigger, sides trimmed' },
  { id: 'track', label: 'Follow speaker', note: 'Crop follows who talks' },
];
const LENGTHS = [
  { id: 'auto', label: 'Auto' }, { id: 'u1', label: '< 1 min' }, { id: '2', label: '~2 min' },
  { id: '5', label: '~5 min' }, { id: '8', label: '~8 min' },
];

const KEYFRAMES = `
@keyframes smPop{0%,100%{transform:scale(1)}8%{transform:scale(1.18)}16%{transform:scale(1)}}
@keyframes smSwipe{0%,12%{background-size:0% 100%}30%,100%{background-size:100% 100%}}
@keyframes smPush{0%{transform:scale(1)}100%{transform:scale(1.12)}}
@keyframes smFill{0%{width:0}100%{width:100%}}
@keyframes smFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes smConf{0%{transform:translateY(-10px) rotate(0);opacity:0}15%{opacity:1}100%{transform:translateY(60px) rotate(260deg);opacity:0}}
@keyframes smGlow{0%,100%{box-shadow:0 0 0 2px rgba(239,68,68,.25)}50%{box-shadow:0 0 0 6px rgba(239,68,68,.45)}}
@keyframes smCount{0%{content:"0"}25%{content:"250"}50%{content:"600"}75%,100%{content:"1,000"}}
@keyframes smDraw{0%,15%{stroke-dashoffset:120}45%,100%{stroke-dashoffset:0}}
`;

// ── small parts ───────────────────────────────────────────────────────────────────────────────────
const Tick: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-white transition-all ${on ? 'bg-thumb-red scale-100' : 'scale-0'}`}>
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3.4}><path d="M20 6 9 17l-5-5" /></svg>
  </span>
);

const cardCls = (on: boolean) =>
  `relative rounded-2xl border-2 transition-all text-left ${on ? 'border-thumb-red shadow-[0_8px_24px_-8px_rgba(239,68,68,.45)] -translate-y-0.5' : 'border-thumb-line hover:border-thumb-red/40 hover:-translate-y-0.5'}`;

// a caption sample: "THIS CHANGED EVERYTHING", the key word in the look
const CaptionSample: React.FC<{ cap: Cap; dark: boolean; size?: number; animate?: boolean; marker?: boolean; circle?: boolean }> =
  ({ cap, dark, size = 13, animate, marker, circle }) => {
    if (cap.id === 'off') return <span className="text-[11px] font-bold" style={{ color: dark ? '#fff8' : '#0006' }}>— no words —</span>;
    const ink = dark ? '#fff' : '#111';
    const keyStyle: React.CSSProperties = {
      ...cap.key,
      ...(marker ? { backgroundImage: 'linear-gradient(#FDE047,#FDE047)', backgroundRepeat: 'no-repeat', backgroundSize: '100% 100%', animation: animate ? 'smSwipe 3s ease-out infinite' : undefined, padding: '0 3px' } : {}),
    };
    return (
      <span className="inline-flex flex-col items-center leading-[1.08] text-center whitespace-nowrap" style={{ fontFamily: cap.font, fontSize: size, ...cap.wrap }}>
        <span style={{ color: ink, fontWeight: 800, ...cap.soft }}>{cap.id === 'poster_words' ? 'this changed' : 'THIS CHANGED'}</span>
        <span className="relative inline-block" style={{ animation: animate ? 'smPop 2.4s ease-in-out infinite' : undefined }}>
          <span style={{ fontWeight: 900, color: ink, textTransform: 'uppercase', ...keyStyle }}>EVERYTHING</span>
          {circle && (
            <svg viewBox="0 0 100 40" className="absolute -inset-x-2 -inset-y-1.5 w-[calc(100%+16px)] h-[calc(100%+12px)] pointer-events-none" preserveAspectRatio="none">
              <ellipse cx="50" cy="20" rx="47" ry="17" fill="none" stroke="#EF4444" strokeWidth="3" strokeDasharray="120" style={{ animation: animate ? 'smDraw 3s ease-out infinite' : undefined }} />
            </svg>
          )}
        </span>
      </span>
    );
  };

// the video stand-in: a soft gradient "frame" with two heads
const Footage: React.FC<{ className?: string; style?: React.CSSProperties; push?: boolean }> = ({ className = '', style, push }) => (
  <div className={`relative overflow-hidden ${className}`} style={style}>
    <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg,#334155,#0F172A)', animation: push ? 'smPush 6s ease-in-out infinite alternate' : undefined }}>
      <div className="absolute bottom-0 left-[18%] w-[26%] h-[62%] rounded-t-full bg-[#F4C7A1]/90" />
      <div className="absolute bottom-0 right-[16%] w-[26%] h-[56%] rounded-t-full bg-[#D6A07A]/90" />
      <div className="absolute top-2 left-2 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
    </div>
  </div>
);

// ── the live phone preview ───────────────────────────────────────────────────────────────────────
export const PhonePreview: React.FC<{ look: ShortsLook; compact?: boolean }> = ({ look, compact }) => {
  const studio = look.style === 'split';
  const bg = BGS.find(b => b.id === look.bg) || BGS[2];
  const dark = studio ? !!bg.dark : look.style === 'boxed';
  const caps = studio ? CAPS : SIMPLE_CAPS;
  const cap = caps.find(c => c.id === look.caption) || caps[0];
  const on = (k: string) => studio && (look.fxMode === 'auto' ? ['marker', 'push_in', 'progress', 'counter', 'burst'].includes(k) : look.fx.includes(k));
  const w = compact ? 150 : 240;
  const pageBg: React.CSSProperties = studio ? bg.css : look.style === 'boxed' ? { background: '#0B0B0F' } : { background: '#fff' };

  return (
    <div className="flex flex-col items-center gap-3">
      <style>{KEYFRAMES}</style>
      <div className="relative rounded-[34px] p-[7px] bg-[#111] shadow-[0_30px_60px_-20px_rgba(0,0,0,.45)]" style={{ width: w, animation: 'smFloat 6s ease-in-out infinite' }}>
        <div className="relative overflow-hidden rounded-[28px]" style={{ aspectRatio: '9 / 16', ...pageBg }}>
          <div className="absolute top-1.5 left-1/2 -translate-x-1/2 w-14 h-3.5 rounded-full bg-black z-20" />
          {on('progress') && <div className="absolute top-0 left-0 h-1 bg-thumb-red z-10" style={{ animation: 'smFill 6s linear infinite' }} />}

          {studio && (
            <div className="absolute inset-0 flex flex-col items-center px-[9%] pt-[16%]">
              <p className="text-center font-black leading-tight" style={{ fontSize: w * 0.068, color: dark ? '#fff' : '#111', fontFamily: IMPACT }}>
                HE LOST <span style={{ color: '#EF4444' }}>EVERYTHING</span> IN ONE DAY
              </p>
              <Footage push={on('push_in')} className="mt-[9%] w-full rounded-2xl" style={{ aspectRatio: '4 / 3.4', animation: on('audio_react') ? 'smGlow 1.2s ease-in-out infinite' : undefined, boxShadow: '0 10px 24px -8px rgba(0,0,0,.4)' }} />
              <div className="mt-[10%] min-h-[18%] flex items-center">
                <CaptionSample cap={cap} dark={dark} size={w * 0.07} animate marker={on('marker')} circle={on('scribble') && !on('marker')} />
              </div>
              {on('counter') && (
                <span className="mt-1 px-2 py-0.5 rounded-lg bg-thumb-red text-white font-black" style={{ fontSize: w * 0.06, fontFamily: IMPACT }}>
                  $1,000
                </span>
              )}
            </div>
          )}

          {look.style === 'classic' && (
            <div className="absolute inset-0 flex flex-col">
              <div className="pt-[15%] pb-[6%] px-3 bg-white text-center font-black leading-tight" style={{ fontSize: w * 0.066, fontFamily: IMPACT, color: '#111' }}>
                HE LOST EVERYTHING IN ONE DAY
              </div>
              <Footage className="flex-1" push={look.fit === 'zoom'} />
              <div className="absolute bottom-[14%] inset-x-0 flex justify-center"><CaptionSample cap={cap} dark size={w * 0.07} animate /></div>
            </div>
          )}

          {look.style === 'boxed' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-[7%] gap-[5%]">
              <p className="text-center font-black leading-tight text-white" style={{ fontSize: w * 0.066, fontFamily: IMPACT }}>HE LOST EVERYTHING IN ONE DAY</p>
              <Footage className="w-full rounded-3xl" style={{ aspectRatio: look.fit === 'full' ? '16 / 11' : '4 / 5' }} />
              <CaptionSample cap={cap} dark size={w * 0.07} animate />
            </div>
          )}

          {!studio && look.fit === 'track' && (
            <span className="absolute top-[42%] left-[22%] w-[30%] h-[18%] border-2 border-dashed border-[#4ADE80] rounded-lg z-10" />
          )}

          {on('burst') && ['#EF4444', '#FACC15', '#3B82F6', '#22C55E', '#EC4899'].map((c, i) => (
            <span key={c} className="absolute w-1.5 h-2.5 rounded-sm z-10" style={{ background: c, left: `${14 + i * 17}%`, top: '52%', animation: `smConf 2.6s ${i * 0.25}s ease-out infinite` }} />
          ))}
        </div>
      </div>
      {!compact && (
        <p className="text-[12px] text-thumb-sub text-center max-w-[240px] leading-snug">
          A preview of the look — every Short is made from its own clip{studio && look.fxMode === 'auto' ? ', with effects picked for it' : ''}.
        </p>
      )}
    </div>
  );
};

// ── the picker: small buttons above Generate, each opening a centred scrollable popup ─────────────────
type Panel = 'style' | 'bg' | 'caption' | 'fx' | 'fit' | 'length';
const TITLES: Record<Panel, string> = {
  style: 'Pick a style', bg: 'Pick a background', caption: 'Pick a subtitle look', fx: 'Effects', fit: 'Video fit', length: 'Length of each Short',
};

const Popup: React.FC<{ title: string; hint?: string; onClose: () => void; wide?: boolean; footer?: React.ReactNode; children: React.ReactNode }> =
  ({ title, hint, onClose, wide, footer, children }) => createPortal(
    // on the page root (.thumb-scope keeps the light/dark theme): inside the glass box a "fixed" popup would be
    // trapped by its backdrop-filter
    <div className="fixed inset-0 z-[140] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <style>{KEYFRAMES}</style>
      <div className={`bg-thumb-card border border-thumb-line rounded-2xl p-5 w-full ${wide ? 'max-w-2xl' : 'max-w-xl'} max-h-[80vh] flex flex-col shadow-2xl`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-black text-thumb-ink">{title}</h3>
            {hint && <p className="text-xs text-thumb-sub mt-0.5">{hint}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto no-scrollbar pt-1 pr-1 -mr-1">{children}</div>
        {footer && <div className="pt-3 mt-3 border-t border-thumb-line">{footer}</div>}
      </div>
    </div>,
    document.querySelector('.thumb-scope') || document.body,
  );

const StyleMock: React.FC<{ id: string }> = ({ id }) => (
  <div className="mx-auto w-[58px] rounded-xl overflow-hidden border border-black/10" style={{ aspectRatio: '9 / 16', background: id === 'boxed' ? '#0B0B0F' : '#fff' }}>
    {id === 'split' && (<div className="h-full flex flex-col items-center pt-2 px-1.5 gap-1">
      <div className="h-1 w-4/5 rounded bg-black/80" /><div className="h-1 w-3/5 rounded bg-thumb-red" />
      <Footage className="w-full rounded-md mt-1" style={{ aspectRatio: '1 / 1' }} />
      <div className="h-1.5 w-3/4 rounded bg-[#FACC15] mt-1" /></div>)}
    {id === 'classic' && (<div className="h-full flex flex-col">
      <div className="h-[22%] flex flex-col items-center justify-center gap-0.5"><div className="h-1 w-4/5 rounded bg-black/80" /><div className="h-1 w-3/5 rounded bg-black/80" /></div>
      <Footage className="flex-1" /></div>)}
    {id === 'boxed' && (<div className="h-full flex flex-col items-center justify-center px-1.5 gap-1">
      <div className="h-1 w-4/5 rounded bg-white/80" /><Footage className="w-full rounded-lg" style={{ aspectRatio: '1 / 1' }} /><div className="h-1 w-3/5 rounded bg-white/70" /></div>)}
  </div>
);

export const LookBar: React.FC<{ look: ShortsLook; onChange: (l: ShortsLook) => void }> = ({ look, onChange }) => {
  const [open, setOpen] = React.useState<Panel | null>(null);
  const set = (patch: Partial<ShortsLook>) => onChange({ ...look, ...patch });
  const pickOne = (patch: Partial<ShortsLook>) => { set(patch); setOpen(null); };
  const studio = look.style === 'split';
  const bg = BGS.find(b => b.id === look.bg) || BGS[2];
  const caps = studio ? CAPS : SIMPLE_CAPS;
  const cap = caps.find(c => c.id === look.caption) || caps[0];
  const style = STYLES.find(s => s.id === look.style) || STYLES[0];
  const small = typeof window !== 'undefined' && window.innerWidth < 640;
  const toggleFx = (id: string) => set({ fx: look.fx.includes(id) ? look.fx.filter(f => f !== id) : [...look.fx, id] });

  const Btn: React.FC<{ panel: Panel; label: string; value: string; icon: React.ReactNode; changed?: boolean }> = ({ panel, label, value, icon, changed }) => (
    <button type="button" onClick={() => setOpen(panel)}
      className={`h-16 min-w-0 rounded-xl border-2 flex flex-col items-center justify-center gap-0.5 px-1 transition-colors ${changed ? 'border-thumb-red bg-thumb-redSoft' : 'border-dashed border-white/12 hover:border-thumb-red'}`}>
      <span className="h-4 flex items-center">{icon}</span>
      <span className={`text-[10.5px] sm:text-[11px] font-bold leading-tight truncate max-w-full ${changed ? 'text-thumb-red' : 'text-thumb-sub'}`}>{label}</span>
      <span className="text-[9.5px] text-thumb-sub leading-tight truncate max-w-full">{value}</span>
    </button>
  );

  const buttons = [
    <Btn key="style" panel="style" label="Style" value={style.label} changed={look.style !== 'split'}
      icon={<span className="w-2.5 h-4 rounded-[3px] border-[1.5px] border-current text-thumb-sub" />} />,
    studio
      ? <Btn key="bg" panel="bg" label="Background" value={bg.label} changed={look.bg !== 'white'}
          icon={<span className="w-4 h-4 rounded-full border border-black/20" style={bg.css} />} />
      : <Btn key="fit" panel="fit" label="Fit" value={FITS.find(f => f.id === look.fit)?.label || 'Full video'} changed={look.fit !== 'full'}
          icon={<span className="text-[12px]">🎯</span>} />,
    <Btn key="caption" panel="caption" label="Subtitles" value={cap.label} changed={look.caption !== 'auto'}
      icon={<span className="text-[12px] font-black text-thumb-sub" style={{ fontFamily: IMPACT }}>Aa</span>} />,
    ...(studio ? [<Btn key="fx" panel="fx" label="Effects" value={look.fxMode === 'auto' ? 'Auto' : `${look.fx.length} on`} changed={look.fxMode !== 'auto' || !look.sfx}
      icon={<span className="text-[12px]">✨</span>} />] : []),
    <Btn key="length" panel="length" label="Length" value={LENGTHS.find(l => l.id === look.length)?.label || 'Auto'} changed={look.length !== 'auto'}
      icon={<span className="text-[12px]">⏱️</span>} />,
  ];

  return (
    <>
      <div className={`grid gap-2 ${buttons.length === 5 ? 'grid-cols-5' : 'grid-cols-4'}`}>{buttons}</div>

      {open === 'style' && (
        <Popup title={TITLES.style} onClose={() => setOpen(null)}>
          <div className="grid grid-cols-3 gap-3">
            {STYLES.map(s => (
              <button key={s.id} type="button" className={`${cardCls(look.style === s.id)} p-2 bg-thumb-soft`}
                onClick={() => pickOne({ style: s.id, caption: (s.id === 'split' ? CAPS : SIMPLE_CAPS).some(c => c.id === look.caption) ? look.caption : 'auto' })}>
                <Tick on={look.style === s.id} />
                <StyleMock id={s.id} />
                <p className="mt-2 text-[13px] font-black text-thumb-ink text-center">{s.label}</p>
                <p className="text-[10.5px] text-thumb-sub text-center leading-tight mt-0.5">{s.note}</p>
              </button>
            ))}
          </div>
        </Popup>
      )}

      {open === 'bg' && (
        <Popup title={TITLES.bg} hint="🤖 Auto: AI reads each clip’s mood and picks · 🎲 Mix: a different one every Short" onClose={() => setOpen(null)}>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {BGS.map(b => (
              <button key={b.id} type="button" onClick={() => pickOne({ bg: b.id })} className={`${cardCls(look.bg === b.id)} overflow-hidden`}>
                <Tick on={look.bg === b.id} />
                <div className="relative h-[72px] flex items-center justify-center" style={b.css}>
                  {b.tag
                    ? <span className="text-[13px] font-black text-[#111] drop-shadow-[0_1px_0_#fff]">{b.tag}</span>
                    : <span className="w-[42%] h-[46%] rounded-md shadow-md" style={{ background: 'linear-gradient(160deg,#334155,#0F172A)' }} />}
                </div>
                <p className="px-2 py-1.5 text-[11.5px] font-bold text-thumb-ink truncate bg-thumb-card">{b.label}</p>
              </button>
            ))}
          </div>
        </Popup>
      )}

      {open === 'caption' && (
        <Popup title={TITLES.caption} onClose={() => setOpen(null)}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {caps.map(c => (
              <button key={c.id} type="button" onClick={() => pickOne({ caption: c.id })} className={`${cardCls(look.caption === c.id)} overflow-hidden`}>
                <Tick on={look.caption === c.id} />
                <div className="h-[76px] overflow-hidden flex items-center justify-center px-1" style={studio ? bg.css : { background: 'linear-gradient(160deg,#334155,#0F172A)' }}>
                  <CaptionSample cap={c} dark={studio ? !!bg.dark : true} size={small ? 12 : 14} animate={look.caption === c.id} />
                </div>
                <p className="px-2 py-1.5 text-[11.5px] font-bold text-thumb-ink truncate bg-thumb-card">{c.label}</p>
              </button>
            ))}
          </div>
        </Popup>
      )}

      {open === 'fx' && (
        <Popup title={TITLES.fx} wide onClose={() => setOpen(null)}
          hint={look.fxMode === 'auto' ? 'Every Short gets its own mix, picked to fit the clip' : `${look.fx.length} picked — each Short uses some of them`}
          footer={
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 text-[13px] font-bold text-thumb-ink cursor-pointer">
                <button type="button" role="switch" aria-checked={look.sfx} onClick={() => set({ sfx: !look.sfx })}
                  className={`relative shrink-0 w-10 h-6 rounded-full transition-colors ${look.sfx ? 'bg-thumb-red' : 'bg-thumb-soft border border-thumb-line'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${look.sfx ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                🔊 Sound effects
              </label>
              <button type="button" onClick={() => setOpen(null)} className="thumb-btn px-5 h-10 rounded-xl text-white font-black text-[14px]">Done</button>
            </div>
          }>
          <div className="flex gap-4 items-start">
            <div className="hidden sm:block shrink-0"><PhonePreview look={look} compact /></div>
            <div className="flex-1 min-w-0 space-y-3">
              <div className="grid grid-cols-2 p-1 rounded-xl bg-thumb-soft border border-thumb-line">
                {(['auto', 'pick'] as const).map(m => (
                  <button key={m} type="button"
                    onClick={() => set({ fxMode: m, fx: m === 'pick' && !look.fx.length ? FX.map(f => f.id).filter(id => id !== 'stickers' && id !== 'facts') : look.fx })}
                    className={`py-2 rounded-lg text-[13px] font-black transition-colors ${look.fxMode === m ? 'bg-thumb-card text-thumb-ink shadow-sm' : 'text-thumb-sub'}`}>
                    {m === 'auto' ? '✨ Auto (AI picks)' : '☑️ Choose myself'}
                  </button>
                ))}
              </div>
              <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 transition-opacity ${look.fxMode === 'auto' ? 'opacity-45 pointer-events-none' : ''}`}>
                {FX.map(f => {
                  const sel = look.fxMode === 'auto' || look.fx.includes(f.id);
                  return (
                    <button key={f.id} type="button" onClick={() => toggleFx(f.id)}
                      className={`flex items-start gap-2 p-2.5 rounded-xl border-2 text-left transition-colors ${sel ? 'border-thumb-red bg-thumb-redSoft' : 'border-thumb-line bg-thumb-soft hover:border-thumb-red/40'}`}>
                      <span className={`mt-0.5 w-4 h-4 shrink-0 rounded-md border-2 flex items-center justify-center ${sel ? 'bg-thumb-red border-thumb-red text-white' : 'border-thumb-line'}`}>
                        {sel && <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={4}><path d="M20 6 9 17l-5-5" /></svg>}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-black text-thumb-ink leading-tight">{f.icon} {f.label}</span>
                        <span className="block text-[11px] text-thumb-sub leading-snug mt-0.5">{f.note}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11.5px] text-thumb-sub">🎯 The crop follows whoever is talking — always on in Studio.</p>
            </div>
          </div>
        </Popup>
      )}

      {open === 'fit' && (
        <Popup title={TITLES.fit} onClose={() => setOpen(null)}>
          <div className="grid grid-cols-3 gap-3">
            {FITS.map(f => (
              <button key={f.id} type="button" onClick={() => pickOne({ fit: f.id })} className={`${cardCls(look.fit === f.id)} p-2.5 bg-thumb-soft`}>
                <Tick on={look.fit === f.id} />
                <div className="relative mx-auto w-[46px] rounded-lg overflow-hidden bg-black" style={{ aspectRatio: '9 / 16' }}>
                  <Footage className="absolute inset-x-0 top-1/2 -translate-y-1/2" style={{ height: f.id === 'full' ? '38%' : '100%', left: f.id === 'track' ? '-40%' : f.id === 'zoom' ? '-60%' : 0, width: f.id === 'full' ? '100%' : '220%' }} />
                  {f.id === 'track' && <span className="absolute top-[40%] left-[18%] w-[60%] h-[22%] border border-dashed border-[#4ADE80] rounded" />}
                </div>
                <p className="mt-1.5 text-[12.5px] font-black text-thumb-ink text-center">{f.label}</p>
                <p className="text-[10.5px] text-thumb-sub text-center leading-tight">{f.note}</p>
              </button>
            ))}
          </div>
        </Popup>
      )}

      {open === 'length' && (
        <Popup title={TITLES.length} hint="Auto: whatever length the best moment needs" onClose={() => setOpen(null)}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {LENGTHS.map(l => (
              <button key={l.id} type="button" onClick={() => pickOne({ length: l.id })}
                className={`${cardCls(look.length === l.id)} h-14 bg-thumb-soft text-[14px] font-black text-thumb-ink flex items-center justify-center`}>
                <Tick on={look.length === l.id} />{l.label}
              </button>
            ))}
          </div>
        </Popup>
      )}
    </>
  );
};
