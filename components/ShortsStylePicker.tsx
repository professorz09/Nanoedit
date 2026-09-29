import React from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../hooks/useScrollLock';

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
  explain: boolean;     // 📊 AI explainer designs: fact cards, number counters, money stacks
  broll: boolean;       // 🔬 AI B-roll: a real, labelled picture of what is explained
  stickers: boolean;    // 🎨 AI stickers
  fit: string;          // full | zoom | track (Classic & Boxed)
  length: string;
  count: string;        // how many Shorts: auto | 3 | 5 | 10 | 15 | 20
}

export const DEFAULT_LOOK: ShortsLook = {
  style: 'split', bg: 'white', caption: 'auto', fxMode: 'auto', fx: [], sfx: true, explain: true, broll: false, stickers: true, fit: 'full', length: 'auto', count: 'auto',
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
    // the motion effects are always the AI's pick; the four switches add their own groups
    fx: [...MOTION_FX, ...(l.explain ? EXPLAIN_FX : []), ...(l.stickers ? ['stickers'] : []), ...(l.broll ? ['real_images'] : [])],
    sfx: l.sfx,
    fit: studio ? 'full' : l.fit,
    count: l.count === 'auto' ? undefined : Number(l.count),
  };
};

// the Effects popup is one Auto (these, picked per clip) plus four switches
const MOTION_FX = ['hook_freeze', 'card_drop', 'card_move', 'push_in', 'zoom_punch', 'cascade', 'marker', 'scribble', 'burst', 'audio_react', 'progress'];
const EXPLAIN_FX = ['facts', 'counter', 'scramble', 'money_stack'];
const FX_SWITCHES: { key: 'explain' | 'broll' | 'stickers' | 'sfx'; img?: string; label: string; note: string }[] = [
  { key: 'explain', img: 'fx-explain', label: 'AI explainer designs', note: 'Fact cards, counting numbers, money stacks' },
  { key: 'broll', img: 'fx-broll', label: 'AI B-roll', note: 'A real picture of what is being explained' },
  { key: 'stickers', img: 'fx-stickers', label: 'AI stickers', note: 'A drawn sticker of what is said' },
  { key: 'sfx', label: 'Sound effects', note: 'Whooshes and pops on the big moments' },
];

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
  { id: 'white', label: 'White', css: { background: '#FFFFFF' } },
  { id: 'ai', label: 'Auto', tag: 'AI', css: { background: 'conic-gradient(from 200deg, #FDE047, #F9A8D4, #93C5FD, #86EFAC, #FDE047)' } },
  { id: 'random', label: 'Mix', tag: '🎲', css: { background: 'linear-gradient(135deg,#fff 0 25%,#FDE047 25% 50%,#0B0B0F 50% 75%,#A3111B 75%)' } },
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
  { id: 'sticky_blue', label: 'Blue sticky notes', font: HAND, key: { color: '#111', background: '#7DD3FC', padding: '0 6px', transform: 'rotate(-3deg)', display: 'inline-block' } },
  { id: 'underline_swipe', label: 'Underline swipe', font: '"Inter", system-ui, sans-serif', key: { color: '#111', borderBottom: '3px solid #84CC16' } },
  { id: 'chalkboard', label: 'Chalkboard', font: HAND, key: { color: '#fff' }, wrap: { background: '#123524', padding: '4px 8px' }, soft: { color: '#d1fae5' } },
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
  { id: 'rgb_split', label: 'RGB glitch', font: IMPACT, key: { color: '#111', textShadow: '-2px 0 #EF4444, 2px 0 #3B82F6' } },
  { id: 'minimal', label: 'Minimal', font: '"Inter", system-ui, sans-serif', key: { fontWeight: 600, letterSpacing: 0 }, soft: { fontWeight: 400 } },
  { id: 'poster_words', label: 'Poster words', font: IMPACT, key: { fontSize: '1.5em', lineHeight: 1 } },
  { id: 'off', label: 'No subtitles', key: {} },
];
const SH = '0 1px 0 #000, 0 0 3px rgba(0,0,0,.9), 0 2px 6px rgba(0,0,0,.6)';
const SIMPLE_CAPS: Cap[] = [
  { id: 'auto', label: 'Auto mix', font: IMPACT, key: { color: '#FACC15', textShadow: SH }, soft: { color: '#fff', textShadow: SH } },
  { id: 'animated', label: 'Animated', font: IMPACT, key: { color: '#4ADE80', textShadow: SH }, soft: { color: '#fff', textShadow: SH } },
  { id: 'simple', label: 'Simple', font: '"Arial Black", sans-serif', key: { color: '#fff', textShadow: SH }, soft: { color: '#fff', textShadow: SH } },
  { id: 'off', label: 'No subtitles', key: {} },
]

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
  { id: 'real_images', icon: '🔬', label: 'Real images', note: 'A real, labelled photo of what is explained' },
];

const FITS = [
  { id: 'full', label: 'Full video', note: 'Nothing cut off' },
  { id: 'zoom', label: 'Zoomed', note: 'Bigger, sides trimmed' },
  { id: 'track', label: 'Follow speaker', note: 'Crop follows who talks' },
];
const COUNTS = ['auto', '3', '5', '10', '15', '20'];
const LENGTHS = [
  { id: 'auto', label: 'Auto' }, { id: 'u1', label: '< 1 min' }, { id: '2', label: '~2 min' },
  { id: '5', label: '~5 min' }, { id: '8', label: '~8 min' },
];

const KEYFRAMES = `
@keyframes smPop{0%,100%{transform:scale(1)}8%{transform:scale(1.18)}16%{transform:scale(1)}}
@keyframes smSwipe{0%,12%{background-size:0% 100%}30%,100%{background-size:100% 100%}}
@keyframes smPush{0%{transform:scale(1)}100%{transform:scale(1.14)}}
@keyframes smFill{0%{width:0}100%{width:100%}}
@keyframes smFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes smConf{0%{transform:translateY(-10px) rotate(0);opacity:0}15%{opacity:1}100%{transform:translateY(60px) rotate(260deg);opacity:0}}
@keyframes smGlow{0%,100%{box-shadow:0 0 0 2px rgba(239,68,68,.35),0 0 10px rgba(239,68,68,.3)}50%{box-shadow:0 0 0 5px rgba(239,68,68,.6),0 0 22px rgba(239,68,68,.6)}}
@keyframes smDraw{0%,15%{stroke-dashoffset:120}45%,100%{stroke-dashoffset:0}}
@keyframes smDrop{0%,8%{transform:translateY(-160%)}22%{transform:translateY(6%)}28%{transform:translateY(-3%)}34%,100%{transform:translateY(0)}}
@keyframes smSwap{0%,30%{transform:translateX(0)}42%,72%{transform:translateX(18%) scale(.84)}84%,100%{transform:translateX(0)}}
@keyframes smPunch{0%,30%,100%{transform:scale(1)}34%{transform:scale(1.22) rotate(-1.5deg)}38%{transform:scale(1.16) rotate(1.5deg)}44%{transform:scale(1.18)}60%{transform:scale(1)}}
@keyframes smUnfold{0%,10%{transform:rotateX(90deg);opacity:0}30%,100%{transform:rotateX(0);opacity:1}}
@keyframes smRoll{0%{transform:translateY(0)}60%,100%{transform:translateY(-75%)}}
@keyframes smStack{0%,10%{transform:scaleY(.1)}55%,100%{transform:scaleY(1)}}
@keyframes smBar{0%,10%{transform:scaleX(0)}50%,100%{transform:scaleX(1)}}
@keyframes smSticker{0%,15%{transform:scale(0) rotate(-20deg)}28%{transform:scale(1.15) rotate(6deg)}36%,80%{transform:scale(1) rotate(-4deg)}90%,100%{transform:scale(0)}}
@keyframes smPhoto{0%,15%{transform:translateY(30%) rotate(6deg);opacity:0}32%,85%{transform:translateY(0) rotate(-3deg);opacity:1}100%{opacity:0}}
@keyframes smCover{0%,45%{opacity:1}52%,100%{opacity:0}}
@keyframes smVu{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
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
const CaptionSample: React.FC<{ cap: Cap; dark: boolean; size?: number; animate?: boolean; marker?: boolean; circle?: boolean; words?: [string, string] }> =
  ({ cap, dark, size = 13, animate, marker, circle, words = ['THIS CHANGED', 'EVERYTHING'] }) => {
    if (cap.id === 'off') return <span className="text-[11px] font-bold" style={{ color: dark ? '#fff8' : '#0006' }}>— no words —</span>;
    const ink = dark ? '#fff' : '#111';
    const keyStyle: React.CSSProperties = {
      ...cap.key,
      ...(marker ? { backgroundImage: 'linear-gradient(#FDE047,#FDE047)', backgroundRepeat: 'no-repeat', backgroundSize: '100% 100%', animation: animate ? 'smSwipe 3s ease-out infinite' : undefined, padding: '0 3px' } : {}),
    };
    return (
      <span className="inline-flex flex-col items-center leading-[1.08] text-center whitespace-nowrap" style={{ fontFamily: cap.font, fontSize: size, ...cap.wrap }}>
        <span style={{ color: ink, fontWeight: 800, ...cap.soft }}>{cap.id === 'poster_words' ? words[0].toLowerCase() : words[0]}</span>
        <span className="relative inline-block" style={{ animation: animate ? 'smPop 2.4s ease-in-out infinite' : undefined }}>
          <span style={{ fontWeight: 900, color: ink, textTransform: 'uppercase', ...keyStyle }}>{words[1]}</span>
          {circle && (
            <svg viewBox="0 0 100 40" className="absolute -inset-x-2 -inset-y-1.5 w-[calc(100%+16px)] h-[calc(100%+12px)] pointer-events-none" preserveAspectRatio="none">
              <ellipse cx="50" cy="20" rx="47" ry="17" fill="none" stroke="#EF4444" strokeWidth="3" strokeDasharray="120" style={{ animation: animate ? 'smDraw 3s ease-out infinite' : undefined }} />
            </svg>
          )}
        </span>
      </span>
    );
  };

// the video stand-in: the pasted video's own thumbnail when there is one, else a podcast-studio scene
const ThumbCtx = React.createContext<string | null>(null);
// a real podcast frame (public/home/footage.jpg, from a real Short) instead of a drawing
const REAL_FOOTAGE = '/home/footage.jpg';

// every option's card: a real frame of a Short made with that option by the render server (Movievideomaker's
// pipeline.shorts_split / assemble.build_shorts_final) on the MrBeast podcast clip — public/shorts-looks/
const LOOK_IMG = (name: string) => `/shorts-looks/${name}.webp`;
const HAS_IMG = new Set([
  'style-split', 'style-classic', 'style-boxed', 'fit-full', 'fit-zoom', 'fit-track',
  'simple-auto', 'simple-animated', 'simple-simple', 'simple-off', 'cap-auto', 'cap-poster_words', 'cap-off',
  ...['white', 'white_grid', 'yellow', 'blue', 'green', 'pink', 'glass', 'black', 'black_grid', 'wall_red', 'wall_maroon',
    'wall_navy', 'wall_emerald', 'wall_purple', 'wall_teal', 'wall_charcoal'].map(b => `bg-${b}`),
  ...['sticky_blue', 'underline_swipe', 'chalkboard', 'hormozi', 'mrbeast', 'neon_green', 'glass', 'red_box', 'black_box',
    'karaoke', 'highlighter', 'comic', 'fire', 'ice', 'gold', 'typewriter', 'sticker', 'chat_bubble', 'sticky_note',
    'news_bar', 'pop_art', 'rgb_split', 'minimal'].map(c => `cap-${c}`),
]);

const RealShot: React.FC<{ name: string; className?: string; style?: React.CSSProperties; focusY?: number }> = ({ name, className = '', style, focusY }) => (
  <div className={`relative overflow-hidden bg-black ${className}`} style={style}>
    <img src={LOOK_IMG(name)} alt="" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover"
      style={{ objectPosition: `50% ${focusY ?? 50}%` }} />
  </div>
);

export const Studio = () => (
  <svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full">
    <defs>
      <radialGradient id="smWall" cx="50%" cy="30%" r="80%"><stop offset="0" stopColor="#3b2a4d" /><stop offset="1" stopColor="#120d1a" /></radialGradient>
      <linearGradient id="smDesk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5b3a24" /><stop offset="1" stopColor="#2a1a10" /></linearGradient>
    </defs>
    <rect width="160" height="120" fill="url(#smWall)" />
    <circle cx="28" cy="22" r="9" fill="#ffb86b" opacity=".22" /><circle cx="132" cy="18" r="12" fill="#6bd3ff" opacity=".16" />
    <circle cx="80" cy="12" r="6" fill="#ff6b9a" opacity=".18" />
    <rect x="68" y="30" width="24" height="34" rx="2" fill="#241a30" /><rect x="71" y="33" width="18" height="12" rx="1" fill="#ff3355" opacity=".55" />
    {/* left: host */}
    <path d="M18 120 C18 92 30 82 46 82 C62 82 74 92 74 120Z" fill="#1f3b63" />
    <ellipse cx="46" cy="64" rx="12" ry="14" fill="#e8b48f" /><path d="M33 60 C33 46 59 44 59 58 C56 52 38 52 33 60Z" fill="#2b1b12" />
    <rect x="44" y="76" width="4" height="7" fill="#d69f7c" />
    {/* right: guest */}
    <path d="M88 120 C88 94 99 84 114 84 C129 84 142 94 142 120Z" fill="#7a2230" />
    <ellipse cx="114" cy="66" rx="12" ry="14" fill="#c98c66" /><path d="M101 62 C99 46 128 44 127 60 C124 51 106 52 101 62Z" fill="#111" />
    <rect x="112" y="78" width="4" height="7" fill="#b87d59" />
    {/* mics */}
    <path d="M60 50 L66 70" stroke="#222" strokeWidth="2" /><rect x="56" y="70" width="8" height="14" rx="4" fill="#222" transform="rotate(-18 60 77)" />
    <path d="M100 52 L94 72" stroke="#222" strokeWidth="2" /><rect x="92" y="72" width="8" height="14" rx="4" fill="#222" transform="rotate(18 96 79)" />
    <rect x="0" y="104" width="160" height="16" fill="url(#smDesk)" />
  </svg>
);

const Footage: React.FC<{ className?: string; style?: React.CSSProperties; anim?: string }> = ({ className = '', style, anim }) => {
  const thumb = React.useContext(ThumbCtx);
  return (
    <div className={`relative overflow-hidden ${className}`} style={style}>
      <div className="absolute inset-0" style={{ animation: anim }}>
        <img src={thumb || REAL_FOOTAGE} alt="" className="absolute inset-0 w-full h-full object-cover" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      </div>
    </div>
  );
};

// ── a phone with the look on it (the popups' previews and the live one) ────────────────────────────────
export const PhonePreview: React.FC<{ look: ShortsLook; width?: number; fxOnly?: string; still?: boolean; frame?: boolean;
  head?: [string, string, string]; words?: [string, string] }> =
  ({ look, width = 150, fxOnly, still, frame = true, head = ['HE LOST', 'EVERYTHING', 'IN ONE DAY'], words }) => {
    const studio = look.style === 'split';
    const bg = BGS.find(b => b.id === look.bg) || BGS[0];
    const dark = studio ? !!bg.dark : look.style === 'boxed';
    const caps = studio ? CAPS : SIMPLE_CAPS;
    const cap = caps.find(c => c.id === look.caption) || caps[0];
    const on = (k: string) => studio && (fxOnly ? fxOnly === k : look.fxMode === 'pick' && look.fx.includes(k));
    const w = width;
    const ink = dark ? '#fff' : '#111';
    const pageBg: React.CSSProperties = studio ? bg.css : look.style === 'boxed' ? { background: '#0B0B0F' } : { background: '#fff' };
    const A = (v: string) => (still ? undefined : v);
    const headline = (color = ink) => (
      <p className="text-center font-black leading-[1.05]" style={{ fontSize: w * 0.075, color, fontFamily: IMPACT, letterSpacing: '.01em' }}>
        {head[0]} <span style={{ color: '#EF4444' }}>{head[1]}</span><br />{head[2]}
      </p>
    );
    const cardAnim = on('card_drop') ? A('smDrop 3.2s ease-out infinite') : on('card_move') ? A('smSwap 4s ease-in-out infinite') : undefined;
    const footAnim = on('push_in') ? A('smPush 4s ease-in-out infinite alternate') : on('zoom_punch') ? A('smPunch 2.6s ease-out infinite') : undefined;

    const screen = (
      <div className="relative overflow-hidden" style={{ aspectRatio: '9 / 16', borderRadius: frame ? w * 0.13 : 12, ...pageBg }}>
        {frame && <div className="absolute left-1/2 -translate-x-1/2 rounded-full bg-black z-30" style={{ top: w * 0.025, width: w * 0.28, height: w * 0.065 }} />}
        {on('progress') && <div className="absolute top-0 left-0 h-[3px] bg-thumb-red z-20" style={{ animation: A('smFill 5s linear infinite'), width: still ? '60%' : undefined }} />}

        {studio && (
          <div className="absolute inset-0 flex flex-col items-center px-[8%]" style={{ paddingTop: '15%' }}>
            {headline()}
            <div className="relative w-full mt-[7%]" style={{ animation: cardAnim }}>
              <Footage anim={footAnim} className="w-full rounded-[10px]"
                style={{ aspectRatio: '4 / 3.3', boxShadow: '0 8px 20px -8px rgba(0,0,0,.55)', animation: on('audio_react') ? A('smGlow 1.1s ease-in-out infinite') : undefined }} />
              {on('audio_react') && (
                <div className="absolute -right-[7%] bottom-[8%] flex items-end gap-[2px] h-[40%]">
                  {[0, 1, 2, 3].map(i => <span key={i} className="w-[3px] h-full bg-thumb-red rounded origin-bottom" style={{ animation: A(`smVu .${5 + i}s ease-in-out ${i * 0.1}s infinite`) }} />)}
                </div>
              )}
              {on('stickers') && (
                <span className="absolute -right-[4%] -top-[10%] leading-none" style={{ fontSize: w * 0.2, filter: 'drop-shadow(0 0 0 #fff) drop-shadow(2px 0 0 #fff) drop-shadow(-2px 0 0 #fff) drop-shadow(0 2px 0 #fff) drop-shadow(0 -2px 0 #fff) drop-shadow(0 3px 4px rgba(0,0,0,.35))', animation: A('smSticker 3s ease-out infinite') }}>💸</span>
              )}
              {on('hook_freeze') && (
                <div className="absolute inset-0 rounded-[10px] bg-black/35 flex items-center justify-center" style={{ animation: A('smCover 4s steps(1) infinite') }}>
                  <span className="rounded-full bg-white/90 flex items-center justify-center" style={{ width: w * 0.16, height: w * 0.16 }}>
                    <svg viewBox="0 0 24 24" style={{ width: w * 0.07 }} fill="#111"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                </div>
              )}
            </div>

            <div className="mt-[8%] flex flex-col items-center gap-1" style={{ perspective: 200 }}>
              <div style={{ animation: on('cascade') ? A('smUnfold 2.4s ease-out infinite') : undefined, transformOrigin: 'top' }}>
                <CaptionSample cap={cap} dark={dark} size={w * 0.072} animate={!still} marker={on('marker')} circle={on('scribble')} words={words} />
              </div>
              {(on('counter') || on('money_stack')) && (
                <div className="flex items-end gap-1.5 mt-0.5">
                  {on('money_stack') && (
                    <div className="flex flex-col-reverse gap-[1px] origin-bottom" style={{ animation: A('smStack 2.8s ease-out infinite') }}>
                      {[0, 1, 2, 3].map(i => <span key={i} className="block rounded-[2px] border border-[#14532d]" style={{ width: w * 0.12, height: w * 0.035, background: '#22C55E' }} />)}
                    </div>
                  )}
                  <span className="px-1.5 py-0.5 rounded-md bg-thumb-red text-white font-black" style={{ fontSize: w * 0.065, fontFamily: IMPACT }}>$10,000</span>
                </div>
              )}
              {on('scramble') && (
                <span className="relative overflow-hidden rounded-md bg-[#111] text-[#FACC15] font-black px-1.5" style={{ fontSize: w * 0.07, fontFamily: IMPACT, height: w * 0.1, lineHeight: `${w * 0.1}px` }}>
                  <span className="flex flex-col" style={{ animation: A('smRoll 1.6s steps(3) infinite') }}>
                    <span>$73,912</span><span>$18,406</span><span>$52,771</span><span>$10,000</span>
                  </span>
                </span>
              )}
              {on('facts') && (
                <div className="rounded-md bg-white shadow-md px-1.5 py-1 space-y-[3px]" style={{ width: w * 0.62 }}>
                  {[0.9, 0.55, 0.3].map((f, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="text-[#111] font-bold" style={{ fontSize: w * 0.04, width: w * 0.12 }}>{['2024', '2023', '2022'][i]}</span>
                      <span className="h-[4px] rounded origin-left" style={{ width: `${f * 60}%`, background: ['#EF4444', '#F97316', '#FACC15'][i], animation: A(`smBar 2.6s ${i * 0.15}s ease-out infinite`) }} />
                    </div>
                  ))}
                </div>
              )}
              {on('real_images') && (
                <div className="bg-white p-[3px] pb-[6px] shadow-md" style={{ width: w * 0.36, animation: A('smPhoto 3.4s ease-out infinite') }}>
                  <div style={{ aspectRatio: '1 / 1', background: 'linear-gradient(160deg,#fde68a,#f59e0b 60%,#92400e)' }} className="flex items-center justify-center" >
                    <span style={{ fontSize: w * 0.14 }}>🏦</span>
                  </div>
                  <p className="text-center text-[#111] font-bold mt-[2px]" style={{ fontSize: w * 0.04 }}>Wall Street</p>
                </div>
              )}
            </div>
          </div>
        )}

        {look.style === 'classic' && (
          <div className="absolute inset-0 flex flex-col">
            <div className="bg-white px-2 pb-[6%]" style={{ paddingTop: '16%' }}>{headline('#111')}</div>
            <div className="relative flex-1 bg-black flex items-center">
              <Footage className="w-full" style={{ height: look.fit === 'full' ? '42%' : '100%' }} anim={look.fit === 'zoom' ? A('smPush 4s ease-in-out infinite alternate') : undefined} />
            </div>
            <div className="absolute bottom-[12%] inset-x-0 flex justify-center"><CaptionSample cap={cap} dark size={w * 0.072} animate={!still} /></div>
          </div>
        )}

        {look.style === 'boxed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-[7%] gap-[5%]">
            {headline('#fff')}
            <Footage className="w-full rounded-2xl" style={{ aspectRatio: look.fit === 'full' ? '16 / 11' : '4 / 5' }} />
            <CaptionSample cap={cap} dark size={w * 0.072} animate={!still} />
          </div>
        )}

        {!studio && look.fit === 'track' && (
          <span className="absolute top-[42%] left-[20%] w-[34%] h-[20%] border-2 border-dashed border-[#4ADE80] rounded-lg z-10" />
        )}
        {on('burst') && ['#EF4444', '#FACC15', '#3B82F6', '#22C55E', '#EC4899', '#A855F7'].map((c, i) => (
          <span key={c} className="absolute rounded-sm z-10" style={{ width: w * 0.03, height: w * 0.05, background: c, left: `${10 + i * 15}%`, top: '48%', animation: A(`smConf 2.4s ${i * 0.2}s ease-out infinite`) }} />
        ))}
      </div>
    );

    return (
      <div style={{ width: w }} className="shrink-0">
        <style>{KEYFRAMES}</style>
        {frame ? <div className="rounded-[18%/10%] bg-[#111] shadow-[0_18px_40px_-16px_rgba(0,0,0,.5)]" style={{ padding: w * 0.04, borderRadius: w * 0.16 }}>{screen}</div> : screen}
      </div>
    );
  };

// ── the picker: small buttons above Generate, each opening a centred scrollable popup ─────────────────
type Panel = 'style' | 'bg' | 'caption' | 'fx' | 'fit' | 'length' | 'count';
const TITLES: Record<Panel, string> = {
  style: 'Pick a style', bg: 'Pick a background', caption: 'Pick a subtitle look', fx: 'Effects', fit: 'Video fit', length: 'Length of each Short', count: 'How many Shorts',
};

const Popup: React.FC<{ title: string; hint?: string; onClose: () => void; wide?: boolean; footer?: React.ReactNode; children: React.ReactNode }> =
  ({ title, hint, onClose, wide, footer, children }) => {
  // the page behind stays put while the popup is open (no scrolling it on phones either); Esc closes it
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  useScrollLock();
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return createPortal(
    // on the page root (.thumb-scope keeps the light/dark theme): inside the glass box a "fixed" popup would be
    // trapped by its backdrop-filter
    <div className="fixed inset-0 z-[140] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 overscroll-contain" onClick={onClose}>
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
        <div className="overflow-y-auto overscroll-contain no-scrollbar pt-1 pr-1 -mr-1" style={{ touchAction: 'pan-y' }}>{children}</div>
        {footer && <div className="pt-3 mt-3 border-t border-thumb-line">{footer}</div>}
      </div>
    </div>,
    document.querySelector('.thumb-scope') || document.body,
  );
};

// brollOk: the user's plan has 🔬 AI B-roll (the Creator plan); onUpgrade: where a locked B-roll tap goes
export const LookBar: React.FC<{ look: ShortsLook; onChange: (l: ShortsLook) => void; thumb?: string | null; brollOk?: boolean; onUpgrade?: () => void }> =
  ({ look, onChange, thumb = null, brollOk = true, onUpgrade }) => {
  const [open, setOpen] = React.useState<Panel | null>(null);
  const set = (patch: Partial<ShortsLook>) => onChange({ ...look, ...patch });
  const pickOne = (patch: Partial<ShortsLook>) => { set(patch); setOpen(null); };
  const studio = look.style === 'split';
  const bg = BGS.find(b => b.id === look.bg) || BGS[0];
  const caps = studio ? CAPS : SIMPLE_CAPS;
  const cap = caps.find(c => c.id === look.caption) || caps[0];
  const style = STYLES.find(s => s.id === look.style) || STYLES[0];
  const small = typeof window !== 'undefined' && window.innerWidth < 640;

  const svg = (d: React.ReactNode) => (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  );
  const ICONS = {
    style: svg(<><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M9.5 18.5h5" /></>),
    fit: svg(<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="12" r="3" /></>),
    caption: svg(<><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M10 10.2a2.2 2.2 0 1 0 0 3.6M16.5 10.2a2.2 2.2 0 1 0 0 3.6" /></>),
    fx: svg(<><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>),
    count: svg(<><rect x="3" y="4" width="7" height="12" rx="1.5" /><rect x="14" y="8" width="7" height="12" rx="1.5" /></>),
    length: svg(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9.5 2.5h5" /></>),
  };

  const Chip: React.FC<{ panel: Panel; label: string; value: string; icon: React.ReactNode }> = ({ panel, label, value, icon }) => (
    <button type="button" onClick={() => setOpen(panel)} title={label}
      className="group w-full sm:w-auto inline-flex items-center gap-2 h-11 sm:h-10 pl-3 pr-2.5 rounded-xl bg-thumb-soft border border-thumb-line text-thumb-ink hover:border-thumb-red/50 transition-colors">
      <span className="text-thumb-sub group-hover:text-thumb-red transition-colors">{icon}</span>
      <span className="flex flex-col items-start leading-none min-w-0">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-thumb-sub">{label}</span>
        <span className="text-[13px] font-bold mt-[3px] whitespace-nowrap truncate max-w-full">{value}</span>
      </span>
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-thumb-sub ml-auto sm:ml-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="m6 9 6 6 6-6" /></svg>
    </button>
  );

  const bgLabel = look.bg === 'ai' ? 'AI auto' : bg.label;
  const buttons = [
    <Chip key="style" panel="style" label="Style" value={style.label} icon={ICONS.style} />,
    studio
      ? <Chip key="bg" panel="bg" label="Background" value={bgLabel}
          icon={<span className="block w-4 h-4 rounded-full ring-1 ring-black/15" style={bg.css} />} />
      : <Chip key="fit" panel="fit" label="Fit" value={FITS.find(f => f.id === look.fit)?.label || 'Full video'} icon={ICONS.fit} />,
    <Chip key="caption" panel="caption" label="Subtitles" value={cap.label} icon={ICONS.caption} />,
    ...(studio ? [<Chip key="fx" panel="fx" label="Effects" value={(() => { const n = FX_SWITCHES.filter(f => look[f.key] && (f.key !== 'broll' || brollOk)).length; return n ? `Auto + ${n}` : 'Auto'; })()} icon={ICONS.fx} />] : []),
    <Chip key="count" panel="count" label="Shorts" value={look.count === 'auto' ? 'Auto' : `${look.count} Shorts`} icon={ICONS.count} />,
    <Chip key="length" panel="length" label="Length" value={LENGTHS.find(l => l.id === look.length)?.label || 'Auto'} icon={ICONS.length} />,
  ];

  return (
    <ThumbCtx.Provider value={thumb}>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap [&>*:last-child:nth-child(odd)]:col-span-2">{buttons}</div>

      {open === 'style' && (
        <Popup title={TITLES.style} onClose={() => setOpen(null)}>
          <div className="grid grid-cols-3 gap-3">
            {STYLES.map(s => (
              <button key={s.id} type="button" className={`${cardCls(look.style === s.id)} p-2 sm:p-3 bg-thumb-soft flex flex-col items-center`}
                onClick={() => pickOne({ style: s.id, caption: (s.id === 'split' ? CAPS : SIMPLE_CAPS).some(c => c.id === look.caption) ? look.caption : 'auto' })}>
                <Tick on={look.style === s.id} />
                {HAS_IMG.has(`style-${s.id}`)
                  ? <RealShot name={`style-${s.id}`} className="rounded-[14px] shadow-md" style={{ width: small ? 88 : 128, aspectRatio: '9 / 16' }} />
                  : <PhonePreview look={{ ...look, style: s.id, fxMode: 'auto' }} width={small ? 88 : 128} />}
                <p className="mt-2 text-[13px] font-black text-thumb-ink text-center">{s.label}</p>
                <p className="text-[10.5px] text-thumb-sub text-center leading-tight mt-0.5">{s.note}</p>
              </button>
            ))}
          </div>
        </Popup>
      )}

      {open === 'bg' && (
        <Popup title={TITLES.bg} hint="🤖 Auto: AI reads each clip’s mood and picks · 🎲 Mix: a different one every Short" onClose={() => setOpen(null)}>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {BGS.map(b => (
              <button key={b.id} type="button" onClick={() => pickOne({ bg: b.id })} className={`${cardCls(look.bg === b.id)} p-1.5 bg-thumb-soft flex flex-col items-center`}>
                <Tick on={look.bg === b.id} />
                <div className="relative">
                  {HAS_IMG.has(`bg-${b.id}`)
                    ? <RealShot name={`bg-${b.id}`} className="rounded-[12px]" style={{ width: small ? 82 : 104, aspectRatio: '9 / 16' }} />
                    : <PhonePreview look={{ ...look, style: 'split', bg: b.id, fxMode: 'auto' }} width={small ? 82 : 104} still frame={false} />}
                  {b.tag && <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/75 text-white text-[10px] font-black">{b.tag === '🎲' ? '🎲 MIX' : '🤖 AI'}</span>}
                </div>
                <p className="mt-1.5 text-[11.5px] font-bold text-thumb-ink truncate max-w-full">{b.label}</p>
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
                {HAS_IMG.has(`${studio ? 'cap' : 'simple'}-${c.id}`)
                  ? <RealShot name={`${studio ? 'cap' : 'simple'}-${c.id}`} className="h-[76px]" focusY={studio ? 44 : 60} />
                  : (
                    <div className="h-[76px] overflow-hidden flex items-center justify-center px-1" style={{ background: studio ? '#FFFFFF' : 'linear-gradient(160deg,#334155,#0F172A)' }}>
                      <CaptionSample cap={c} dark={!studio} size={small ? 12 : 14} animate={look.caption === c.id} />
                    </div>
                  )}
                <p className="px-2 py-1.5 text-[11.5px] font-bold text-thumb-ink truncate bg-thumb-card">{c.label}</p>
              </button>
            ))}
          </div>
        </Popup>
      )}

      {open === 'fx' && (
        <Popup title={TITLES.fx} hint="Auto effects are always on — add the extras you want" onClose={() => setOpen(null)}
          footer={<button type="button" onClick={() => setOpen(null)} className="thumb-btn w-full h-11 rounded-xl text-white font-black text-[14px]">Done</button>}>
          <div className="flex items-center gap-3 p-2 pr-3 rounded-2xl border-2 border-thumb-line bg-thumb-soft">
            <RealShot name="fx-auto" className="rounded-xl shrink-0" style={{ width: 64, aspectRatio: '9 / 16' }} focusY={40} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-black text-thumb-ink">Auto effects</p>
              <p className="text-[12px] text-thumb-sub leading-snug">Zooms, card moves and word highlights, picked to fit each clip</p>
            </div>
            <span className="shrink-0 px-2 py-1 rounded-lg bg-thumb-card border border-thumb-line text-[10.5px] font-black text-thumb-sub uppercase tracking-wide">Always on</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 mt-2.5">
            {FX_SWITCHES.map(f => {
              const locked = f.key === 'broll' && !brollOk;
              const on = look[f.key] && !locked;
              return (
                <button key={f.key} type="button" role="switch" aria-checked={on}
                  onClick={() => locked ? onUpgrade?.() : set({ [f.key]: !look[f.key] } as Partial<ShortsLook>)}
                  className={`${cardCls(on)} overflow-hidden bg-thumb-soft flex flex-col`}>
                  <div className="relative h-[112px] overflow-hidden">
                    {f.img
                      ? <RealShot name={f.img} className="w-full h-full" focusY={f.key === 'explain' ? 72 : f.key === 'stickers' ? 80 : 50} />
                      : (
                        <div className="absolute inset-0 flex items-center justify-center bg-thumb-card">
                          <svg viewBox="0 0 64 32" className="w-24 h-12 text-thumb-red" fill="currentColor">
                            {[6, 14, 22, 12, 28, 18, 10, 24, 16, 8, 20, 12].map((v, n) => <rect key={n} x={2 + n * 5} y={16 - v / 2} width="3" height={v} rx="1.5" />)}
                          </svg>
                        </div>
                      )}
                    {locked && <div className="absolute inset-0 bg-black/45" />}
                    <span className={`absolute top-1.5 right-1.5 w-9 h-5 rounded-full transition-colors ${on ? 'bg-thumb-red' : 'bg-black/35'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                    </span>
                    {f.key === 'broll' && (
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/75 text-white text-[10px] font-black">
                        {locked ? '🔒 Creator plan' : 'Creator · +1 credit'}
                      </span>
                    )}
                  </div>
                  <div className="px-2.5 py-2 bg-thumb-card flex-1">
                    <p className="text-[12.5px] font-black text-thumb-ink leading-tight">{f.label}</p>
                    <p className="text-[11px] text-thumb-sub leading-snug mt-0.5">{locked ? 'Upgrade to the Creator plan to use it' : f.note}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </Popup>
      )}

      {open === 'fit' && (
        <Popup title={TITLES.fit} onClose={() => setOpen(null)}>
          <div className="grid grid-cols-3 gap-3">
            {FITS.map(f => (
              <button key={f.id} type="button" onClick={() => pickOne({ fit: f.id })} className={`${cardCls(look.fit === f.id)} p-1.5 bg-thumb-soft`}>
                <Tick on={look.fit === f.id} />
                <div className="flex justify-center">
                  <RealShot name={`fit-${f.id}`} className="rounded-[12px]" style={{ width: small ? 80 : 104, aspectRatio: '9 / 16' }} />
                </div>
                <p className="mt-1.5 text-[12.5px] font-black text-thumb-ink text-center">{f.label}</p>
                <p className="text-[10.5px] text-thumb-sub text-center leading-tight">{f.note}</p>
              </button>
            ))}
          </div>
        </Popup>
      )}

      {open === 'count' && (
        <Popup title={TITLES.count} hint="Auto: every moment good enough to post" onClose={() => setOpen(null)}>
          <div className="grid grid-cols-3 gap-2.5">
            {COUNTS.map(c => (
              <button key={c} type="button" onClick={() => pickOne({ count: c })}
                className={`${cardCls(look.count === c)} h-16 bg-thumb-soft flex flex-col items-center justify-center`}>
                <Tick on={look.count === c} />
                <span className="text-[18px] font-black text-thumb-ink leading-none">{c === 'auto' ? 'Auto' : c}</span>
                <span className="text-[11px] text-thumb-sub mt-1">{c === 'auto' ? 'best ones' : 'Shorts'}</span>
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
    </ThumbCtx.Provider>
  );
};
