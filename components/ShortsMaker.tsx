import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { extractYouTubeId } from '../services/youtubeService';
import {
  ShortClip, ShortsProject, createProject, fmtTime, getProject, isShortsConfigured, listProjects,
  renderAll, renderShort, startDownload, trimShort,
} from '../services/shortsService';

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

const LENGTHS = [
  { id: 'auto', label: 'Auto' },
  { id: 'u1', label: '< 1 min' },
  { id: '2', label: '2 min' },
  { id: '5', label: '5 min' },
  { id: '8', label: '8 min' },
];
const SUBTITLES = [
  { id: 'auto', label: 'Auto' },
  { id: 'animated', label: 'Animated' },
  { id: 'simple', label: 'Simple' },
  { id: 'off', label: 'Off' },
];
const STYLES = [
  { id: 'split', label: 'Studio' },
  { id: 'classic', label: 'Classic' },
  { id: 'boxed', label: 'Boxed' },
];

const Select: React.FC<{ value: string; onChange: (v: string) => void; options: { id: string; label: string }[]; label: string }> =
  ({ value, onChange, options, label }) => (
    <label className="relative flex-1 min-w-0 block">
      <span className="pointer-events-none absolute left-3 top-2 text-[10px] font-bold uppercase tracking-wider text-thumb-sub">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full appearance-none bg-thumb-soft border border-thumb-line rounded-xl pl-3 pr-7 pt-6 pb-2.5 text-[14px] font-black text-thumb-ink focus:border-thumb-red/50 outline-none cursor-pointer truncate"
      >
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-thumb-sub" fill="none" stroke="currentColor" strokeWidth={2.6}><path d="m6 9 6 6 6-6" /></svg>
    </label>
  );

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
const ShortCard: React.FC<{
  clip: ShortClip; videoId: string | null; duration: number | null;
  onTrim: (c: ShortClip, start: number, end: number) => void;
  onDownload: (c: ShortClip) => void;
}> = ({ clip, videoId, duration, onTrim, onDownload }) => {
  const [playing, setPlaying] = useState(false);
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
  const embed = videoId
    ? `https://www.youtube-nocookie.com/embed/${videoId}?start=${Math.floor(clip.start)}&end=${Math.ceil(clip.end)}&autoplay=1&rel=0&modestbranding=1&playsinline=1`
    : '';

  const Nudge = ({ which, d, text }: { which: 'start' | 'end'; d: number; text: string }) => (
    <button type="button" disabled={busy} onClick={() => nudge(which, d)}
      className="w-10 h-10 rounded-xl bg-thumb-soft border border-thumb-line text-thumb-ink font-black text-[13px] hover:border-thumb-red/40 disabled:opacity-40 transition-colors">
      {text}
    </button>
  );

  return (
    <div className="thumb-glass rounded-3xl overflow-hidden flex flex-col animate-fade-in-up">
      <div className="relative aspect-video bg-black">
        {playing && embed ? (
          <iframe
            key={`${clip.start}-${clip.end}`}
            src={embed}
            title={clip.title}
            className="absolute inset-0 w-full h-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
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
        <span className="absolute top-2.5 right-2.5 bg-black/70 text-white text-[11px] font-bold px-2 py-1 rounded-lg">#{clip.idx + 1}</span>
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

        {/* trim */}
        <div className="bg-thumb-soft border border-thumb-line rounded-2xl p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Length</span>
            <span className="flex items-center gap-2">
              <span className="text-[13px] font-black text-thumb-ink tabular-nums">{fmtTime(len)}</span>
              {trimmed && !busy && (
                <button type="button" onClick={() => onTrim(clip, clip.orig_start, clip.orig_end)} className="inline-flex items-center gap-1 text-[11px] font-bold text-thumb-red hover:underline">
                  <Ic.Reset className="w-3 h-3" /> Reset
                </button>
              )}
            </span>
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
              {clip.status === 'ready' ? 'Download' : clip.paid ? 'Download · free re-make' : 'Download · 1 credit'}
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

// ── the page ─────────────────────────────────────────────────────────────────────────────────────
const ShortsMaker: React.FC<{ onRequireLogin: (reason?: string) => void; onBuyCredits: () => void }> = ({ onRequireLogin, onBuyCredits }) => {
  const { user, configured, totalCredits, refreshProfile } = useAuth();
  const [url, setUrl] = useState('');
  const [length, setLength] = useState('auto');
  const [subtitles, setSubtitles] = useState('auto');
  const [style, setStyle] = useState('split');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [projects, setProjects] = useState<ShortsProject[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [project, setProject] = useState<ShortsProject | null>(null);
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
    listProjects().then(setProjects).catch(e => { setProjects([]); setNote(e.message); });
  }, [signedIn]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // the open project, kept fresh while anything in it is still being made
  useEffect(() => {
    if (openId == null) { setProject(null); return; }
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const p = await getProject(openId);
        if (stop) return;
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

  const generate = async () => {
    setNote(null);
    if (!extractYouTubeId(url.trim())) { setNote('Paste a valid YouTube link.'); return; }
    if (!signedIn) { onRequireLogin('Log in to make Shorts.'); return; }
    setBusy(true);
    try {
      const id = await createProject({ url: url.trim(), length, subtitles, style });
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
    if (configured && !clip.paid && totalCredits < 1) { setNote('You need 1 credit to download this Short.'); onBuyCredits(); return; }
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

  const onDownloadAll = async () => {
    if (!project?.shorts) return;
    setNote(null);
    if (project.zip) { startDownload(project.zip); return; }
    const unpaid = project.shorts.filter(s => !s.paid).length;
    if (configured && unpaid > totalCredits) { setNote(`You need ${unpaid} credits to download all (you have ${totalCredits}).`); onBuyCredits(); return; }
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

  if (!isShortsConfigured) {
    return (
      <div className="thumb-glass rounded-3xl p-10 text-center max-w-xl mx-auto">
        <h2 className="text-xl font-black text-thumb-ink">Shorts Maker is coming soon</h2>
        <p className="text-sm text-thumb-sub mt-2">It isn't switched on for this site yet.</p>
      </div>
    );
  }

  const noteBox = note && (
    <div className="text-[13px] bg-thumb-redSoft text-thumb-red border border-thumb-red/20 rounded-xl px-4 py-3 leading-relaxed">{note}</div>
  );

  // ── one project ──
  if (openId != null) {
    const shorts = project?.shorts || [];
    const made = shorts.filter(s => s.status === 'ready').length;
    const working = shorts.filter(s => s.status === 'queued' || s.status === 'rendering').length;
    const unpaid = shorts.filter(s => !s.paid).length;
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <button type="button" onClick={() => { setOpenId(null); loadProjects(); }} className="inline-flex items-center gap-1.5 text-sm font-bold text-thumb-sub hover:text-thumb-ink">
          <Ic.Back className="w-4 h-4" /> All projects
        </button>

        {/* header */}
        <div className="thumb-glass rounded-3xl p-4 sm:p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
          <div className="w-full sm:w-56 aspect-video rounded-2xl overflow-hidden shrink-0 bg-thumb-soft">
            {project?.thumb ? <img src={project.thumb} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full thumb-skeleton" />}
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
              {unpaid ? `${unpaid} credit${unpaid === 1 ? '' : 's'} for the Shorts not made yet · ` : ''}Each Short is made when you download it and kept for 24 hours.
            </p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {!project || project.status === 'finding'
            ? Array.from({ length: 6 }, (_, i) => <ShortSkeleton key={i} />)
            : shorts.map(s => (
              <ShortCard key={s.id} clip={s} videoId={project.video_id} duration={project.duration} onTrim={onTrim} onDownload={onDownload} />
            ))}
        </div>
      </div>
    );
  }

  // ── start page: the link box + the projects ──
  return (
    <div className="max-w-6xl mx-auto space-y-10">
      <div className="text-center space-y-3 pt-2">
        <h1 className="text-[34px] sm:text-5xl font-black tracking-tight text-thumb-ink leading-[1.05]">
          TURN VIDEOS INTO <span className="text-thumb-red">VIRAL SHORTS</span>
        </h1>
        <p className="text-sm sm:text-base text-thumb-sub">Paste a YouTube link — we find the best moments. Preview free, pay only for what you download.</p>
      </div>

      <div className="thumb-glass rounded-[28px] p-4 sm:p-5 max-w-2xl mx-auto space-y-3.5">
        <textarea
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generate(); } }}
          rows={3}
          placeholder="Paste a YouTube link…"
          className="w-full bg-transparent px-2 pt-2 text-[17px] text-thumb-ink placeholder:text-thumb-sub/60 outline-none resize-none"
        />
        <div className="flex gap-2">
          <Select label="Duration" value={length} onChange={setLength} options={LENGTHS} />
          <Select label="Subtitles" value={subtitles} onChange={setSubtitles} options={SUBTITLES} />
          <Select label="Style" value={style} onChange={setStyle} options={STYLES} />
        </div>
        {noteBox}
        <button type="button" onClick={generate} disabled={busy}
          className="thumb-btn w-full h-[60px] rounded-2xl text-white font-black text-[18px] flex items-center justify-center gap-2.5 disabled:text-white/70">
          {busy ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Starting…</>
            : <><Ic.Scissors className="w-5 h-5" /> Generate Shorts</>}
        </button>
      </div>

      {signedIn && (
        <div className="space-y-4">
          <h2 className="text-lg font-black text-thumb-ink">Your projects</h2>
          {projects == null ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="thumb-glass rounded-3xl overflow-hidden">
                  <div className="aspect-video thumb-skeleton" />
                  <div className="p-4 space-y-2"><div className="h-4 w-4/5 rounded thumb-skeleton" /><div className="h-3 w-1/3 rounded thumb-skeleton" /></div>
                </div>
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="thumb-glass rounded-3xl p-10 text-center">
              <div className="w-14 h-14 rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center mx-auto mb-4"><Ic.Scissors className="w-7 h-7" /></div>
              <p className="text-base font-black text-thumb-ink">Your Shorts projects show up here</p>
              <p className="text-sm text-thumb-sub mt-1.5">Paste a link above and hit Generate Shorts.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {projects.map(p => (
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
          )}
        </div>
      )}
    </div>
  );
};

export default ShortsMaker;
