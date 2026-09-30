import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { extractYouTubeId } from '../services/youtubeService';
import {
  ShortClip, ShortsProject, createProject, fmtTime, getProject, isShortsConfigured, listProjects,
  quickProject, quickProjects, renderAll, renderShort, startDownload, trimShort,
} from '../services/shortsService';
import { DEFAULT_LOOK, LookBar, ShortsLook, lookFromProject, lookToRequest } from './ShortsStylePicker';
import { HOME_SHORTS } from './homeShorts';
import VideoPhone from './VideoPhone';

const LOOK_KEY = 'shorts_look_v2'; // v2: everyone starts again on the defaults (White background)
const savedLook = (): ShortsLook => {
  try { return { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem(LOOK_KEY) || '{}') }; } catch { return DEFAULT_LOOK; }
};

// Shorts Maker: paste a YouTube link → a project with the best Short-worthy moments. Each one is previewed
// straight from YouTube (nothing is rendered to preview it), its start/end can be nudged, and it's made
// only when it's downloaded (1 credit the first time). "Download all" makes the rest and hands over a ZIP.

const Ic = {
  Scissors: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" /></svg>),
  Copy: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>),
  Check: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>),
  Download: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>),
  Zip: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 8v13H3V3h12l6 5Z" /><path d="M10 3v2M10 7v2M10 11v2M8 15h4v4H8z" /></svg>),
  Play: (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>),
  Back: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="m15 18-6-6 6-6" /></svg>),
  Fire: (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2s1 3.5-1.5 6.5S7 12 7 15a5 5 0 0 0 10 0c0-2.2-1-3.7-2-5 0 1.5-.8 2.6-2 3 .7-2.6.2-6.4-1-11Z" /></svg>),
  Reset: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>),
};

const CopyButton: React.FC<{ text: string; label: string }> = ({ text, label }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      aria-label={`Copy ${label}`}
      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${done ? 'bg-thumb-greenSoft text-thumb-green border-thumb-green/30' : 'bg-thumb-soft border-thumb-line text-thumb-ink hover:border-thumb-red/40'}`}
    >
      {done ? <><Ic.Check className="w-3.5 h-3.5" /> Copied</> : <><Ic.Copy className="w-3.5 h-3.5" /> Copy</>}
    </button>
  );
};

// ── one Short ────────────────────────────────────────────────────────────────────────────────────
// user-requested ("video me kewal utna hi part dikhe jitna chahiye"): the preview plays only this Short's part — the
// YouTube player with its own controls hidden (they show the whole video's timeline), and our own bar for just this
// part; at its end it goes back to the Short's start and stops.
let youTubeApi: Promise<any> | null = null;
const loadYouTubeApi = (): Promise<any> => {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (!youTubeApi) {
    youTubeApi = new Promise(resolve => {
      const previous = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { previous?.(); resolve(w.YT); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    });
  }
  return youTubeApi;
};

const ClipPlayer: React.FC<{ videoId: string; start: number; end: number }> = ({ videoId, start, end }) => {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const [now, setNow] = useState(start);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    loadYouTubeApi().then(YT => {
      if (!alive || !host.current) return;
      const mount = document.createElement('div');
      host.current.appendChild(mount);
      player.current = new YT.Player(mount, {
        videoId, width: '100%', height: '100%', host: 'https://www.youtube-nocookie.com',
        playerVars: {
          start: Math.floor(start), end: Math.ceil(end), autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0,
          modestbranding: 1, playsinline: 1, iv_load_policy: 3,
        },
        events: {
          onReady: () => alive && setReady(true),
          onStateChange: (e: any) => {
            if (!alive) return;
            setPaused(e.data !== YT.PlayerState.PLAYING);
            if (e.data === YT.PlayerState.ENDED) { e.target.seekTo(start, true); e.target.pauseVideo(); }
          },
        },
      });
      timer = window.setInterval(() => {
        const p = player.current;
        if (!p?.getCurrentTime) return;
        const t = p.getCurrentTime();
        setNow(t);
        if (t >= end) { p.pauseVideo(); p.seekTo(start, true); }
      }, 250);
    });
    return () => {
      alive = false;
      window.clearInterval(timer);
      try { player.current?.destroy(); } catch { /* already gone */ }
      player.current = null;
      if (host.current) host.current.innerHTML = '';
    };
  }, [videoId, start, end]);

  const length = Math.max(1, end - start);
  const at = Math.min(length, Math.max(0, now - start));
  const toggle = () => {
    const p = player.current;
    if (!p?.getPlayerState) return;
    if (paused) p.playVideo(); else p.pauseVideo();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    player.current?.seekTo?.(start + frac * length, true);
    setNow(start + frac * length);
  };

  return (
    <div className="absolute inset-0">
      <div ref={host} className="absolute inset-0 [&_iframe]:w-full [&_iframe]:h-full" />
      {/* taps land here, never on YouTube's own UI (which would show the whole video) */}
      <button type="button" onClick={toggle} aria-label={paused ? 'Play' : 'Pause'} className="absolute inset-0 w-full h-full">
        {(paused || !ready) && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="thumb-btn w-14 h-14 rounded-full flex items-center justify-center text-white">
              <Ic.Play className="w-6 h-6 ml-0.5" />
            </span>
          </span>
        )}
      </button>
      <div className="absolute left-0 right-0 bottom-0 px-3 pb-2.5 pt-6 bg-gradient-to-t from-black/80 to-transparent">
        <div onClick={seek} className="relative h-1.5 rounded-full bg-white/25 cursor-pointer">
          <div className="absolute inset-y-0 left-0 rounded-full bg-thumb-red" style={{ width: `${(at / length) * 100}%` }} />
        </div>
        <div className="mt-1.5 text-[11px] font-bold text-white tabular-nums">{fmtTime(at)} / {fmtTime(length)}</div>
      </div>
    </div>
  );
};

const ShortCard: React.FC<{
  clip: ShortClip; videoId: string | null; duration: number | null;
  onTrim: (c: ShortClip, start: number, end: number) => void;
  onDownload: (c: ShortClip) => void;
  cost: number;
  projectLook: ShortsLook;
  onRemake: (c: ShortClip, look: ShortsLook) => void;
}> = ({ clip, videoId, duration, onTrim, onDownload, cost, projectLook, onRemake }) => {
  const [playing, setPlaying] = useState(false);
  const [showTrim, setShowTrim] = useState(false); // start/end live under "Advanced settings" (user-requested)
  // user-requested: once made, the card plays the real Short, same size as the preview; when its file expires (no
  // view link any more) or the link stops working, it's the YouTube preview of that part again
  const [viewFailed, setViewFailed] = useState<string | null>(null);
  // user-requested: a Short can be made in its own style — starts from the project's, used for that one make only
  // (not saved: once it's sent, this goes back to "Same as project")
  const [customLook, setCustomLook] = useState<ShortsLook | null>(null);
  const made = clip.status === 'ready' && !!clip.view && viewFailed !== clip.view;
  const busy = clip.status === 'queued' || clip.status === 'rendering';
  const len = clip.end - clip.start;
  const trimmed = clip.start !== clip.orig_start || clip.end !== clip.orig_end;
  const nudge = (which: 'start' | 'end', d: number) => {
    const max = duration || clip.end + 600;
    const start = which === 'start' ? Math.min(Math.max(0, clip.start + d), clip.end - 5) : clip.start;
    const end = which === 'end' ? Math.max(Math.min(max, clip.end + d), clip.start + 5) : clip.end;
    setPlaying(false);
    onTrim(clip, start, end);
  };

  const Nudge = ({ which, d, text }: { which: 'start' | 'end'; d: number; text: string }) => (
    <button type="button" disabled={busy} onClick={() => nudge(which, d)}
      className="w-10 h-10 rounded-xl bg-thumb-soft border border-thumb-line text-thumb-ink font-black text-[13px] hover:border-thumb-red/40 disabled:opacity-40 transition-colors">
      {text}
    </button>
  );

  return (
    <div className="thumb-glass rounded-3xl overflow-hidden flex flex-col animate-fade-in-up">
      <div className="relative aspect-video bg-black">
        {made ? (
          <video
            key={clip.view!}
            src={clip.view!}
            poster={videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined}
            controls
            playsInline
            preload="metadata"
            onError={() => setViewFailed(clip.view!)}
            className="absolute inset-0 w-full h-full object-contain bg-black"
          />
        ) : playing && videoId ? (
          <ClipPlayer key={`${clip.start}-${clip.end}`} videoId={videoId} start={clip.start} end={clip.end} />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 w-full h-full" aria-label={`Preview ${clip.title}`}>
            {videoId && <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" className="w-full h-full object-cover opacity-90" loading="lazy" />}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="thumb-btn w-14 h-14 rounded-full flex items-center justify-center text-white group-hover:scale-105 transition-transform">
                <Ic.Play className="w-6 h-6 ml-0.5" />
              </span>
            </span>
            <span className="absolute bottom-2.5 right-2.5 bg-black/75 text-white text-[12px] font-bold px-2 py-1 rounded-lg tabular-nums">
              {fmtTime(clip.start)} – {fmtTime(clip.end)}
            </span>
          </button>
        )}
        {clip.score != null && (
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 bg-thumb-red text-white text-[12px] font-black px-2.5 py-1 rounded-lg shadow-lg">
            <Ic.Fire className="w-3.5 h-3.5" /> {clip.score}
          </span>
        )}
        <span className="absolute top-2.5 right-2.5 bg-black/70 text-white text-[11px] font-bold px-2 py-1 rounded-lg">#{clip.idx + 1}{made ? ' · Made' : ''}</span>
      </div>

      <div className="p-4 sm:p-5 flex flex-col gap-3.5 flex-1">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-[15px] font-black text-thumb-ink leading-snug">{clip.title}</p>
          <CopyButton text={clip.title} label="title" />
        </div>
        {clip.description && (
          <div className="flex items-start gap-2">
            <p className="flex-1 text-[13px] text-thumb-sub leading-relaxed line-clamp-3">{clip.description}</p>
            <CopyButton text={clip.description} label="description" />
          </div>
        )}

        {/* trim — folded under "Advanced settings" (user-requested: not out front) */}
        <div className="bg-thumb-soft border border-thumb-line rounded-2xl">
          <button type="button" onClick={() => setShowTrim(v => !v)} aria-expanded={showTrim}
            className="w-full flex items-center justify-between gap-2 px-3 py-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Advanced settings</span>
            <span className="flex items-center gap-2">
              {trimmed && <span className="text-[11px] font-bold text-thumb-red">Edited</span>}
              <span className="text-[13px] font-black text-thumb-ink tabular-nums">{fmtTime(len)}</span>
              <svg viewBox="0 0 24 24" className={`w-4 h-4 text-thumb-sub transition-transform ${showTrim ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </span>
          </button>
          {showTrim && (
          <div className="px-3 pb-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Start &amp; end</span>
            {trimmed && !busy && (
              <button type="button" onClick={() => onTrim(clip, clip.orig_start, clip.orig_end)} className="inline-flex items-center gap-1 text-[11px] font-bold text-thumb-red hover:underline">
                <Ic.Reset className="w-3 h-3" /> Reset
              </button>
            )}
          </div>
          {(['start', 'end'] as const).map(which => (
            <div key={which} className="flex items-center gap-2">
              <span className="w-12 text-[12px] font-bold text-thumb-sub capitalize">{which}</span>
              <Nudge which={which} d={-5} text="−5" />
              <Nudge which={which} d={-1} text="−1" />
              <span className="flex-1 text-center text-[14px] font-black text-thumb-ink tabular-nums">{fmtTime(which === 'start' ? clip.start : clip.end)}</span>
              <Nudge which={which} d={1} text="+1" />
              <Nudge which={which} d={5} text="+5" />
            </div>
          ))}
          <div className="pt-2.5 mt-1 border-t border-thumb-line space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Video style</span>
              {customLook
                ? <button type="button" onClick={() => setCustomLook(null)} className="inline-flex items-center gap-1 text-[11px] font-bold text-thumb-red hover:underline">
                    <Ic.Reset className="w-3 h-3" /> Same as project
                  </button>
                : <span className="text-[12px] font-bold text-thumb-sub">Same as project</span>}
            </div>
            {customLook ? (
              <>
                <LookBar look={customLook} onChange={setCustomLook} thumb={videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null} perShort />
                <button type="button" disabled={busy} onClick={() => { onRemake(clip, customLook); setCustomLook(null); }}
                  className="thumb-btn w-full h-11 rounded-xl text-white font-black text-[14px] disabled:opacity-50">
                  {clip.paid
                    ? `${clip.status === 'ready' ? 'Remake' : 'Make'} in this style · free`
                    : `Make in this style · ${cost} credit${cost === 1 ? '' : 's'}`}
                </button>
                <p className="text-[11px] text-thumb-sub text-center">Only for this make — next time it's the project's style again.</p>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => setCustomLook(projectLook)}
                className="w-full h-10 rounded-xl bg-thumb-card border border-thumb-line text-thumb-ink font-bold text-[13px] hover:border-thumb-red/40 disabled:opacity-40 transition-colors">
                Change style for this Short
              </button>
            )}
          </div>
          </div>
          )}
        </div>

        <div className="mt-auto space-y-2">
          {clip.status === 'failed' && clip.error && (
            <p className="text-[12px] bg-thumb-redSoft text-thumb-red border border-thumb-red/20 rounded-xl px-3 py-2">{clip.error}</p>
          )}
          {busy ? (
            <div className="relative w-full h-[52px] rounded-2xl overflow-hidden thumb-skeleton flex items-center justify-center">
              <span className="relative text-[14px] font-black text-thumb-ink">{clip.stage || 'Making your Short'}…</span>
            </div>
          ) : (
            <button type="button" onClick={() => onDownload(clip)}
              className="thumb-btn w-full h-[52px] rounded-2xl text-white font-black text-[15px] flex items-center justify-center gap-2">
              <Ic.Download className="w-5 h-5" />
              {clip.status === 'ready' ? 'Download' : clip.paid ? 'Download · free re-make' : `Download · ${cost} credit${cost === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const ShortSkeleton = () => (
  <div className="thumb-glass rounded-3xl overflow-hidden">
    <div className="aspect-video thumb-skeleton" />
    <div className="p-5 space-y-3">
      <div className="h-4 w-4/5 rounded thumb-skeleton" />
      <div className="h-3 w-full rounded thumb-skeleton" />
      <div className="h-3 w-2/3 rounded thumb-skeleton" />
      <div className="h-24 w-full rounded-2xl thumb-skeleton" />
      <div className="h-[52px] w-full rounded-2xl thumb-skeleton" />
    </div>
  </div>
);

// user-requested ("shorts ban rahe hai to niche skeleton kyu... kuch aur animations"): while a project's moments
// are being found, a live panel instead of empty skeleton cards — the steps the server works through (paced by time:
// the server only reports "finding") and the time so far; the project's own thumbnail above gets the scan and the
// voice wave (FindingOverlay), so the thumbnail isn't shown twice (user-requested).
const FINDING_STEPS = [
  'Reading the video’s transcript',
  'Finding the strongest moments',
  'Scoring each one for virality',
  'Writing titles and descriptions',
  'Picking the best cut points',
];
const FINDING_STEP_SEC = 12; // the last step stays until the Shorts arrive

const FindingMoments: React.FC<{ since?: number | null }> = ({ since }) => {
  const [now, setNow] = useState(() => Date.now());
  const [openedAt] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  // the project's own start (unix seconds) when known, so reopening a project doesn't restart the clock
  const startedMs = since && since * 1000 <= now ? since * 1000 : openedAt;
  const elapsed = Math.max(0, Math.floor((now - startedMs) / 1000));
  const step = Math.min(FINDING_STEPS.length - 1, Math.floor(elapsed / FINDING_STEP_SEC));
  return (
    <div className="thumb-glass rounded-3xl p-5 sm:p-6 flex flex-col gap-4 sm:col-span-2 2xl:col-span-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-base font-black text-thumb-ink">Finding your Shorts</p>
        <span className="text-[13px] font-bold text-thumb-sub tabular-nums">{fmtTime(elapsed)}</span>
      </div>
      <ol className="space-y-2.5">
        {FINDING_STEPS.map((label, i) => (
          <li key={label} className={`flex items-center gap-3 text-[14px] font-semibold ${i <= step ? 'text-thumb-ink' : 'text-thumb-sub/60'}`}>
            <span className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[12px] font-black ${
              i < step ? 'bg-thumb-red text-white finding-pop' : i === step ? 'border-2 border-thumb-red text-thumb-red' : 'border border-thumb-line'}`}>
              {i < step ? '✓' : i === step ? <span className="w-2 h-2 rounded-full bg-thumb-red animate-pulse" /> : ''}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-thumb-sub">Usually 1–3 minutes, longer for long videos. You can leave this page — the project keeps going.</p>
    </div>
  );
};

// the header thumbnail while the moments are found: a scan line and a voice wave over it
const FindingOverlay = () => (
  <>
    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
    <div className="finding-scan absolute top-0 bottom-0 left-0 w-[10%] bg-gradient-to-r from-transparent via-thumb-red/50 to-transparent" />
    <div className="absolute bottom-3 left-3 right-3 flex items-end gap-1 h-8" aria-hidden="true">
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} className="finding-wave flex-1 rounded-full bg-white/80"
          style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${(i % 7) * 0.12}s` }} />
      ))}
    </div>
  </>
);

// ── the start page's side: a real finished Short playing, a new one every 10 s ─────────────────────
const ExamplePhone: React.FC = () => {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (HOME_SHORTS.length < 2) return;
    const t = setInterval(() => setI(n => (n + 1) % HOME_SHORTS.length), 10000);
    return () => clearInterval(t);
  }, []);
  const s = HOME_SHORTS[i];
  if (!s) return null;
  return (
    <div className="flex flex-col items-center">
      {/* the badge sits above the phone, centred — never over its frame or screen */}
      <span className="mb-2.5 px-2.5 py-1 rounded-full bg-thumb-red text-white text-[11px] font-black uppercase tracking-wider shadow-sm">Made here</span>
      <VideoPhone key={s.url} short={s} width={180} />
      <p className="mt-3 text-[13px] font-bold text-thumb-ink text-center max-w-[190px] leading-snug line-clamp-2">{s.title}</p>
      <div className="mt-2 flex gap-1.5">
        {HOME_SHORTS.map((x, n) => (
          <button key={x.url} type="button" aria-label={`Example ${n + 1}`} onClick={() => setI(n)}
            className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-thumb-red' : 'w-1.5 bg-thumb-line'}`} />
        ))}
      </div>
    </div>
  );
};

// no projects yet: how it works, and real Shorts made with it
const GettingStarted: React.FC = () => (
  <div className="space-y-6">
    <div className="grid sm:grid-cols-3 gap-3">
      {[
        { n: '1', t: 'Paste a link', d: 'Any YouTube video or podcast — long ones are fine.' },
        { n: '2', t: 'Pick the best moments', d: 'AI finds them and scores each one. Preview, trim, and choose — free.' },
        { n: '3', t: 'Download & post', d: 'Captions, effects and a title are done. One by one or all as a ZIP.' },
      ].map(x => (
        <div key={x.n} className="thumb-glass rounded-2xl p-4 flex gap-3">
          <span className="w-8 h-8 shrink-0 rounded-xl bg-thumb-red text-white font-black flex items-center justify-center">{x.n}</span>
          <span><span className="block text-[14px] font-black text-thumb-ink">{x.t}</span><span className="block text-[12.5px] text-thumb-sub mt-0.5 leading-snug">{x.d}</span></span>
        </div>
      ))}
    </div>
    {HOME_SHORTS.length > 0 && (
      <div>
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-thumb-sub mb-3">Shorts made with PodcastFlux</p>
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 -mx-1 px-1">
          {HOME_SHORTS.map(s => (
            <figure key={s.url} className="shrink-0 w-[140px] sm:w-[170px]">
              <VideoPhone short={s} width={typeof window !== 'undefined' && window.innerWidth < 640 ? 140 : 170} frame={false} />
              <figcaption className="mt-2 text-[12px] font-bold text-thumb-ink leading-snug line-clamp-2">{s.title}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    )}
  </div>
);

// ── the page ─────────────────────────────────────────────────────────────────────────────────────
const ShortsMaker: React.FC<{ onRequireLogin: (reason?: string) => void; onBuyCredits: () => void; startUrl?: string | null; onStarted?: () => void }> = ({ onRequireLogin, onBuyCredits, startUrl, onStarted }) => {
  const { user, configured, totalCredits, refreshProfile, profile } = useAuth();
  // 🔬 AI B-roll is the Creator plan's (id "studio") and adds a credit to each Short made with it
  const brollOk = !configured || profile?.plan === 'studio';
  const [url, setUrl] = useState('');
  const [look, setLookState] = useState<ShortsLook>(savedLook);
  const setLook = (l: ShortsLook) => { setLookState(l); try { localStorage.setItem(LOOK_KEY, JSON.stringify(l)); } catch { /* private mode */ } };
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [projects, setProjects] = useState<ShortsProject[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [project, setProject] = useState<ShortsProject | null>(null);
  const cost = project?.options?.real_images && brollOk ? 2 : 1;  // credits for a Short the first time
  const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;
  const [wantZip, setWantZip] = useState(false);
  const wantShorts = useRef<Set<number>>(new Set());
  const trimTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const signedIn = !configured || !!user;
  // re-arms the polling below after an action (a new render)
  const [pollCount, setPollCount] = useState(0);
  const poke = () => setPollCount(c => c + 1);
  const wantZipRef = useRef(false);

  const loadProjects = useCallback(() => {
    if (!signedIn) return;
    if (!isShortsConfigured) { setProjects([]); return; }
    let fromServer = false;
    // straight from Supabase first (instant), then the render server's own list replaces it
    quickProjects().then(quick => { if (quick && !fromServer) setProjects(prev => prev ?? quick); });
    listProjects()
      .then(list => { fromServer = true; setProjects(list); })
      .catch(e => { fromServer = true; setProjects(prev => prev ?? []); setNote(e.message); });
  }, [signedIn]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // the open project, kept fresh while anything in it is still being made
  useEffect(() => {
    if (openId == null) { setProject(null); return; }
    let stop = false;
    let fromServer = false;
    let timer: ReturnType<typeof setTimeout>;
    // the project straight from Supabase while the render server's answer is on its way
    quickProject(openId).then(quick => {
      if (quick && !stop && !fromServer) setProject(prev => (prev && prev.id === quick.id ? prev : quick));
    });
    const tick = async () => {
      try {
        const p = await getProject(openId);
        if (stop) return;
        fromServer = true;
        setProject(prev => {
          // keep a trim the user just made on screen until the server has it
          if (!prev?.shorts || !p.shorts) return p;
          const pending = trimTimers.current;
          return { ...p, shorts: p.shorts.map(s => (pending[s.id] ? prev.shorts!.find(x => x.id === s.id) || s : s)) };
        });
        for (const s of p.shorts || []) {
          if (s.status === 'ready' && s.download && wantShorts.current.has(s.id)) {
            wantShorts.current.delete(s.id);
            startDownload(s.download);
          }
          if (s.status === 'failed') wantShorts.current.delete(s.id);
        }
        const working = p.status === 'finding' || (p.shorts || []).some(s => s.status === 'queued' || s.status === 'rendering');
        if (p.zip && wantZipRef.current) { wantZipRef.current = false; setWantZip(false); startDownload(p.zip); }
        if (!working && wantZipRef.current && !p.zip) { wantZipRef.current = false; setWantZip(false); }
        if (working) timer = setTimeout(tick, 2500);
        else refreshProfile();
      } catch (e: any) {
        if (!stop) { setNote(e.message); timer = setTimeout(tick, 5000); }
      }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [openId, refreshProfile, pollCount]);

  const generate = async (link: string = url) => {
    setNote(null);
    if (!extractYouTubeId(link.trim())) { setNote('Paste a valid YouTube link.'); return; }
    if (!isShortsConfigured) { setNote('The Shorts server is not connected yet. Please try again later.'); return; }
    if (!signedIn) { onRequireLogin('Log in to make Shorts.'); return; }
    setBusy(true);
    try {
      const id = await createProject({ url: link.trim(), ...lookToRequest({ ...look, broll: look.broll && brollOk }) });
      setUrl('');
      setOpenId(id);
      loadProjects();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      setNote(e.message);
    } finally {
      setBusy(false);
    }
  };

  // a link typed on the home page: made straight away with the saved (or default) look
  const started = useRef(false);
  useEffect(() => {
    if (!startUrl || started.current) return;
    started.current = true;
    setUrl(startUrl);
    onStarted?.();
    generate(startUrl).finally(() => { started.current = false; });
  }, [startUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateClip = (id: number, patch: Partial<ShortClip>) =>
    setProject(p => (p && p.shorts ? { ...p, shorts: p.shorts.map(s => (s.id === id ? { ...s, ...patch } : s)) } : p));

  const onTrim = (clip: ShortClip, start: number, end: number) => {
    updateClip(clip.id, { start, end, status: clip.status === 'ready' ? 'idle' : clip.status });
    clearTimeout(trimTimers.current[clip.id]);
    trimTimers.current[clip.id] = setTimeout(async () => {
      try { await trimShort(clip.id, start, end); } catch (e: any) { setNote(e.message); }
      delete trimTimers.current[clip.id];
    }, 700);
  };

  const flushTrim = async (clip: ShortClip) => {
    if (trimTimers.current[clip.id]) {
      clearTimeout(trimTimers.current[clip.id]);
      delete trimTimers.current[clip.id];
      await trimShort(clip.id, clip.start, clip.end);
    }
  };

  const onDownload = async (clip: ShortClip) => {
    setNote(null);
    if (clip.status === 'ready' && clip.download) { startDownload(clip.download); return; }
    if (configured && !clip.paid && totalCredits < cost) { setNote(`You need ${credits(cost)} to download this Short.`); onBuyCredits(); return; }
    try {
      await flushTrim(clip);
      await renderShort(clip.id);
      wantShorts.current.add(clip.id);
      updateClip(clip.id, { status: 'queued', stage: 'In line', error: null });
      refreshProfile();
      poke();
    } catch (e: any) {
      setNote(e.message);
    }
  };

  const onRemake = async (clip: ShortClip, l: ShortsLook) => {
    setNote(null);
    if (configured && !clip.paid && totalCredits < cost) { setNote(`You need ${credits(cost)} to make this Short.`); onBuyCredits(); return; }
    try {
      await flushTrim(clip);
      const r = lookToRequest(l);
      await renderShort(clip.id, { style: r.style, subtitles: r.subtitles, bg: r.bg, caption_look: r.caption_look, fx: r.fx, sfx: r.sfx, fit: r.fit });
      updateClip(clip.id, { status: 'queued', stage: 'In line', error: null });
      refreshProfile();
      poke();
    } catch (e: any) {
      setNote(e.message);
    }
  };

  const onDownloadAll = async () => {
    if (!project?.shorts) return;
    setNote(null);
    if (project.zip) { startDownload(project.zip); return; }
    const unpaid = project.shorts.filter(s => !s.paid).length * cost;
    if (configured && unpaid > totalCredits) { setNote(`You need ${credits(unpaid)} to download all (you have ${totalCredits}).`); onBuyCredits(); return; }
    try {
      for (const s of project.shorts) await flushTrim(s);
      await renderAll(project.id);
      wantZipRef.current = true;
      setWantZip(true);
      refreshProfile();
      poke();
    } catch (e: any) {
      setNote(e.message);
    }
  };

  const noteBox = note && (
    <div className="text-[13px] bg-thumb-redSoft text-thumb-red border border-thumb-red/20 rounded-xl px-4 py-3 leading-relaxed">{note}</div>
  );

  // ── one project (on a desktop: the right-hand panel, next to the link box) ──
  const renderProject = () => {
    const shorts = project?.shorts || [];
    const made = shorts.filter(s => s.status === 'ready').length;
    const working = shorts.filter(s => s.status === 'queued' || s.status === 'rendering').length;
    const unpaid = shorts.filter(s => !s.paid).length * cost;
    return (
      <div className="space-y-6">
        <button type="button" onClick={() => { setOpenId(null); loadProjects(); }} className="inline-flex items-center gap-1.5 text-sm font-bold text-thumb-sub hover:text-thumb-ink">
          <Ic.Back className="w-4 h-4" /> All projects
        </button>

        {/* header */}
        <div className="thumb-glass rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
          <div className="relative w-full sm:w-56 aspect-video rounded-2xl overflow-hidden shrink-0 bg-thumb-soft">
            {project?.thumb ? <img src={project.thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full thumb-skeleton" />}
            {project?.status === 'finding' && <FindingOverlay />}
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            {project ? <h2 className="text-lg sm:text-xl font-black text-thumb-ink leading-snug line-clamp-2">{project.title}</h2>
              : <div className="h-6 w-3/4 rounded thumb-skeleton" />}
            <p className="text-[13px] text-thumb-sub font-semibold">
              {project?.status === 'finding' ? 'Finding the best moments…'
                : project?.status === 'failed' ? 'Could not make Shorts from this video'
                : project ? `${shorts.length} Shorts${project.duration ? ` · from a ${fmtTime(project.duration)} video` : ''}${made ? ` · ${made} ready` : ''}` : ''}
            </p>
          </div>
        </div>

        {noteBox}
        {project?.status === 'failed' && project.error && (
          <div className="thumb-glass rounded-3xl p-8 text-center">
            <p className="text-base font-bold text-thumb-ink">{project.error}</p>
          </div>
        )}

        {/* download all */}
        {project?.status === 'ready' && shorts.length > 0 && (
          <div className="space-y-1.5">
            {wantZip ? (
              <div className="w-full h-[60px] rounded-2xl thumb-skeleton flex items-center justify-center">
                <span className="text-[15px] font-black text-thumb-ink">Making your Shorts… {made}/{shorts.length} ready</span>
              </div>
            ) : (
              <button type="button" onClick={onDownloadAll} className="thumb-btn w-full h-[60px] rounded-2xl text-white font-black text-[17px] flex items-center justify-center gap-2.5">
                <Ic.Zip className="w-5 h-5" /> Download all ({shorts.length}) as ZIP
              </button>
            )}
            <p className="text-center text-[12px] text-thumb-sub">
              {unpaid ? `${credits(unpaid)} for the Shorts not made yet · ` : ''}Each Short is made when you download it and kept for 24 hours.
            </p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 2xl:grid-cols-3 gap-5">
          {!project
            ? Array.from({ length: 6 }, (_, i) => <ShortSkeleton key={i} />)
            : project.status === 'finding'
            ? <FindingMoments since={project.created_at} />
            : shorts.map(s => (
              <ShortCard key={s.id} clip={s} videoId={project.video_id} duration={project.duration} onTrim={onTrim} onDownload={onDownload} cost={cost}
                projectLook={lookFromProject(project)} onRemake={onRemake} />
            ))}
        </div>
      </div>
    );
  };

  // ── start page: the link box on the left, the projects on the right (like the thumbnail maker); a project
  // opens in that right-hand panel on a desktop, full page on a phone ──
  const formPanel = (
    <div className="space-y-4 min-w-0">
      <div className="thumb-glass rounded-[28px] p-4 sm:p-5 space-y-3.5">
        <textarea
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }}
          rows={2}
          placeholder="Paste a YouTube link…"
          className="w-full bg-transparent px-2 pt-2 text-[17px] text-thumb-ink placeholder:text-thumb-sub/60 outline-none resize-none"
        />
        <LookBar look={look} onChange={setLook} brollOk={brollOk} onUpgrade={onBuyCredits} thumb={extractYouTubeId(url.trim()) ? `https://i.ytimg.com/vi/${extractYouTubeId(url.trim())}/hqdefault.jpg` : null} />
        {openId == null && noteBox}
        <button type="button" onClick={() => generate()} disabled={busy}
          className="thumb-btn w-full h-[60px] rounded-2xl text-white font-black text-[18px] flex items-center justify-center gap-2.5 disabled:text-white/70">
          {busy ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Starting…</>
            : <><Ic.Scissors className="w-5 h-5" /> Generate Shorts</>}
        </button>
      </div>
    </div>
  );

  // nothing yet: the thumbnail maker's empty panel, with a real Short playing in it
  const emptyPanel = (
    <div className="hidden lg:flex rounded-[28px] border-2 border-dashed border-thumb-line bg-thumb-soft p-6 items-center justify-center gap-8 min-h-[520px]">
      <ExamplePhone />
      <div className="max-w-xs">
        <p className="text-xl font-black text-thumb-ink">Your Shorts will appear here</p>
        <p className="text-[14px] text-thumb-sub mt-2 leading-relaxed">Paste a link on the left and hit <b className="text-thumb-ink">Generate</b> — each video becomes a project here. Open it to preview, trim and download its Shorts.</p>
      </div>
    </div>
  );

  const projectsPanel = !signedIn || (projects && projects.length === 0) ? emptyPanel : (
    <div className="space-y-4">
      <h2 className="text-lg font-black text-thumb-ink">Your projects</h2>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
        {projects == null
          ? Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="thumb-glass rounded-3xl overflow-hidden">
              <div className="aspect-video thumb-skeleton" />
              <div className="p-4 space-y-2"><div className="h-4 w-4/5 rounded thumb-skeleton" /><div className="h-3 w-1/3 rounded thumb-skeleton" /></div>
            </div>
          ))
          : projects.map(p => (
            <button key={p.id} type="button" onClick={() => setOpenId(p.id)}
              className="thumb-glass rounded-3xl overflow-hidden text-left hover:ring-2 hover:ring-thumb-red/40 transition-all">
              <div className="relative aspect-video bg-thumb-soft">
                {p.thumb && <img src={p.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />}
                <span className={`absolute bottom-2.5 left-2.5 text-[12px] font-black px-2.5 py-1 rounded-lg ${p.status === 'failed' ? 'bg-black/75 text-white' : 'bg-thumb-red text-white'}`}>
                  {p.status === 'finding' ? 'Finding moments…' : p.status === 'failed' ? 'Failed' : `${p.count ?? 0} Shorts`}
                </span>
              </div>
              <div className="p-4">
                <p className="text-[15px] font-black text-thumb-ink line-clamp-2 leading-snug">{p.title}</p>
                {p.created_at && <p className="text-[12px] text-thumb-sub mt-1">{new Date(p.created_at * 1000).toLocaleDateString()}</p>}
              </div>
            </button>
          ))}
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      <div className="lg:grid lg:grid-cols-[400px_minmax(0,1fr)] gap-8 items-start space-y-8 lg:space-y-0">
        <div className={`lg:sticky lg:top-24 ${openId != null ? 'hidden lg:block' : ''}`}>{formPanel}</div>
        <div className="min-w-0">{openId != null ? renderProject() : projectsPanel}</div>
      </div>
      {openId == null && (!signedIn || (projects && projects.length === 0)) && <GettingStarted />}
    </div>
  );
};

export default ShortsMaker;
