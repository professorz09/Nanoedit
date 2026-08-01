import React, { useState, useRef, useCallback } from 'react';
import { generateText, fetchTranscript, segmentsToText } from '../services/textService';
import { extractYouTubeId } from '../services/youtubeService';
import { useAuth } from '../contexts/AuthContext';
import { getFromLocalStorage, saveToLocalStorage, STORAGE_KEYS } from '../services/storageService';
import { I } from './ThumbIcons';

const TITLE_COST = 1; // credits charged per title-generation run

const Ic = {
  Type: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 7V5h16v2M9 19h6M12 5v14" /></svg>),
  Youtube: (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M23 12s0-3.3-.4-4.9a2.5 2.5 0 0 0-1.8-1.8C19.2 5 12 5 12 5s-7.2 0-8.8.4A2.5 2.5 0 0 0 1.4 7.2C1 8.7 1 12 1 12s0 3.3.4 4.9a2.5 2.5 0 0 0 1.8 1.8C4.8 19 12 19 12 19s7.2 0 8.8-.4a2.5 2.5 0 0 0 1.8-1.8C23 15.3 23 12 23 12zM9.8 15.3V8.7l6 3.3-6 3.3z" /></svg>),
  Doc: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></svg>),
  Copy: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>),
  Check: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>),
  Wand: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" /></svg>),
};

const VIBES = [
  { id: 'clickbait', label: 'Clickbait', hint: 'high-curiosity, punchy, emotional hooks that maximize click-through' },
  { id: 'balanced', label: 'Balanced', hint: 'catchy but honest, clear value with a strong hook' },
  { id: 'seo', label: 'SEO', hint: 'keyword-rich and searchable while staying compelling' },
];

const cleanTitle = (line: string) =>
  line.replace(/^\s*(?:\d+[.)\]]|[-*•])\s*/, '').replace(/^["'“”]+|["'“”]+$/g, '').trim();

const TitleGenerator: React.FC = () => {
  const [tab, setTab] = useState<'youtube' | 'transcript'>('youtube');
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [needPaste, setNeedPaste] = useState(false); // link had no captions → ask for paste
  const [vibe, setVibe] = useState('balanced');
  const [count, setCount] = useState(8);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Persisted across reloads/tab switches, same as generated thumbnails.
  const [titles, setTitlesState] = useState<string[]>(() => getFromLocalStorage(STORAGE_KEYS.TITLE_RESULTS, []));
  const setTitles = (list: string[]) => { setTitlesState(list); saveToLocalStorage(STORAGE_KEYS.TITLE_RESULTS, list); };
  const removeTitle = (i: number) => setTitles(titles.filter((_, x) => x !== i));
  const [copied, setCopied] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { user, totalCredits, configured, refreshProfile } = useAuth();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { setTranscript(String(r.result || '')); setNote(null); };
    r.readAsText(f);
    e.target.value = '';
  };

  const run = useCallback(async () => {
    setNote(null);
    // Title generation is a paid tool — gate on sign-in + credits before doing any work.
    if (configured) {
      if (!user) { setNote('Please sign in to generate titles.'); return; }
      if (totalCredits < TITLE_COST) { setNote(`You need ${TITLE_COST} credits to generate titles. Please top up your plan.`); return; }
    }
    let context = '';

    if (tab === 'youtube') {
      const id = extractYouTubeId(url.trim());
      if (!id) { setNote('Paste a valid YouTube link.'); return; }
      setBusy(true);
      // 1) try captions
      const segs = await fetchTranscript(id).catch(() => null);
      if (segs && segs.length) {
        context = segmentsToText(segs).slice(0, 12000);
        setNeedPaste(false);
      } else if (transcript.trim()) {
        context = transcript.trim().slice(0, 12000);
      } else {
        // 2) fall back to the video's own title/description via oEmbed
        try {
          const o = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`).then(r => r.json());
          if (o?.title) context = `Video title: ${o.title}\nChannel: ${o.author_name || ''}`;
        } catch { /* ignore */ }
        if (!context) {
          setNeedPaste(true);
          setBusy(false);
          setNote('No captions found for this video. Paste the transcript below for better titles.');
          return;
        }
        setNeedPaste(true);
      }
    } else {
      if (!transcript.trim()) { setNote('Paste or upload a transcript first.'); return; }
      context = transcript.trim().slice(0, 12000);
      setBusy(true);
    }

    const vibeHint = VIBES.find(v => v.id === vibe)?.hint || '';
    const prompt = `You are a top YouTube growth strategist. Based on the video content below, write ${count} scroll-stopping YouTube video titles.
Style: ${vibeHint}.
Rules: each title on its OWN line, max ~70 characters, NO numbering, NO quotes, NO hashtags, no extra commentary. Vary the angles (curiosity, benefit, result, question).

VIDEO CONTENT:
${context}`;

    try {
      const out = await generateText(prompt, 'title');
      const list = out.split('\n').map(cleanTitle).filter(Boolean).slice(0, count);
      if (!list.length) {
        setNote('Could not generate titles. Try again.');
      } else {
        setTitles(list);
      }
      refreshProfile(); // credits were charged server-side — sync the header count
    } catch (e: any) {
      setNote(e?.message?.slice(0, 140) || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }, [tab, url, transcript, vibe, count, configured, user, totalCredits, refreshProfile]);

  const copy = (t: string, i: number) => {
    navigator.clipboard?.writeText(t);
    setCopied(i);
    setTimeout(() => setCopied(c => (c === i ? null : c)), 1500);
  };

  return (
    <div className="grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-6 lg:gap-8 items-start max-w-6xl mx-auto">
      {/* ── Controls ── */}
      <div className="thumb-glass rounded-3xl p-5 sm:p-6 space-y-5 lg:sticky lg:top-24">
        <div className="flex items-center gap-3">
          <div className="thumb-btn w-11 h-11 rounded-2xl flex items-center justify-center text-white shrink-0"><Ic.Type className="w-5 h-5" /></div>
          <div>
            <h2 className="text-lg font-black text-thumb-ink leading-tight">Title Generator</h2>
            <p className="text-[13px] text-thumb-sub">Catchy, click-worthy titles from your video</p>
          </div>
        </div>

        {/* Switches */}
        <div className="grid grid-cols-2 gap-1 p-1.5 bg-thumb-soft border border-thumb-line rounded-2xl">
          {([['youtube', 'YouTube link', Ic.Youtube], ['transcript', 'File / transcript', Ic.Doc]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => { setTab(id); setNote(null); }}
              className={`flex items-center justify-center gap-1.5 py-2.5 px-1 rounded-xl text-[12px] font-bold transition-all ${tab === id ? 'thumb-liquid' : 'text-thumb-sub hover:text-thumb-ink hover:bg-thumb-line/50'}`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" /><span>{label}</span>
            </button>
          ))}
        </div>

        {tab === 'youtube' ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">YouTube link</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
                className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 text-sm text-thumb-ink placeholder:text-thumb-sub/60 focus:border-thumb-red/50 outline-none transition-colors"
              />
              <p className="text-[12px] text-thumb-sub">We read the video's captions to understand it. No captions? Paste the transcript below.</p>
            </div>
            {needPaste && (
              <textarea
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                rows={4}
                placeholder="Paste the video transcript here…"
                className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 text-sm text-thumb-ink placeholder:text-thumb-sub/60 focus:border-thumb-red/50 outline-none transition-colors resize-none"
              />
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Transcript</label>
            <textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              rows={6}
              placeholder="Paste your transcript / script here…"
              className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 text-sm text-thumb-ink placeholder:text-thumb-sub/60 focus:border-thumb-red/50 outline-none transition-colors resize-none"
            />
            <button onClick={() => fileRef.current?.click()} className="text-[13px] font-bold text-thumb-red hover:underline inline-flex items-center gap-1.5">
              <Ic.Doc className="w-4 h-4" /> Upload a .txt / .srt / .vtt file
            </button>
            <input ref={fileRef} type="file" accept=".txt,.srt,.vtt,text/plain" onChange={onFile} className="hidden" />
          </div>
        )}

        {/* Options */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Vibe</label>
          <div className="flex gap-1 p-1 bg-thumb-soft border border-thumb-line rounded-xl">
            {VIBES.map(v => (
              <button key={v.id} type="button" onClick={() => setVibe(v.id)} className={`flex-1 py-1.5 rounded-lg text-[13px] font-bold transition-all ${vibe === v.id ? 'thumb-liquid' : 'text-thumb-sub hover:text-thumb-ink'}`}>{v.label}</button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">How many</label>
          <div className="flex gap-1 p-1 bg-thumb-soft border border-thumb-line rounded-xl">
            {[5, 8, 12].map(n => (
              <button key={n} type="button" onClick={() => setCount(n)} className={`flex-1 py-1.5 rounded-lg text-[13px] font-bold transition-all ${count === n ? 'thumb-liquid' : 'text-thumb-sub hover:text-thumb-ink'}`}>{n}</button>
            ))}
          </div>
        </div>

        {note && <div className="text-xs bg-thumb-redSoft text-red-300 border border-thumb-red/20 rounded-xl px-4 py-3 leading-relaxed">{note}</div>}

        <button onClick={run} disabled={busy} className="thumb-btn w-full py-4 rounded-2xl text-white font-black text-lg flex items-center justify-center gap-3 disabled:text-white/70">
          {busy ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analyzing…</> : <><Ic.Wand className="w-5 h-5" /> Generate Titles</>}
        </button>
        <p className="text-center text-[12px] text-thumb-sub -mt-1">Uses {TITLE_COST} credits per generation</p>
      </div>

      {/* ── Results ── */}
      <div className="thumb-glass rounded-3xl p-5 sm:p-6 min-h-[420px]">
        {titles.length > 0 ? (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-thumb-ink uppercase tracking-wider">Suggested titles</h3>
              <span className="text-xs text-thumb-sub">{titles.length}</span>
            </div>
            {titles.map((t, i) => (
              <div key={i} className="group w-full flex items-start gap-1 bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 rounded-xl pl-4 pr-2 py-3 transition-colors">
                <button onClick={() => copy(t, i)} className="flex-1 text-left flex items-start gap-3 min-w-0">
                  <span className="text-[15px] font-semibold text-thumb-ink flex-1 leading-snug">{t}</span>
                  <span className={`shrink-0 mt-0.5 ${copied === i ? 'text-thumb-green' : 'text-thumb-sub group-hover:text-thumb-red'}`}>
                    {copied === i ? <Ic.Check className="w-4 h-4" /> : <Ic.Copy className="w-4 h-4" />}
                  </span>
                </button>
                <button onClick={() => removeTitle(i)} aria-label={`Remove title ${i + 1}`} title="Remove" className="shrink-0 p-1.5 mt-0.5 rounded-lg text-thumb-sub hover:text-thumb-red hover:bg-thumb-redSoft transition-colors">
                  <I.Trash className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-full min-h-[380px] flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center mb-4"><Ic.Type className="w-7 h-7" /></div>
            <h3 className="text-lg font-black text-thumb-ink">Your titles show up here</h3>
            <p className="text-sm text-thumb-sub mt-2 max-w-xs">Drop a YouTube link or transcript on the left and hit <span className="font-bold text-thumb-ink">Generate</span>.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TitleGenerator;
