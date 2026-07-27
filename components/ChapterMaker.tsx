import React, { useState, useCallback } from 'react';
import { generateText, fetchTranscript, segmentsToText, formatTime } from '../services/textService';
import { extractYouTubeId } from './ThumbnailStudio';

const Ic = {
  List: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>),
  Copy: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>),
  Check: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M20 6 9 17l-5-5" /></svg>),
  Wand: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" /></svg>),
  Clock: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>),
};

const DETAIL = [
  { id: 'concise', label: 'Concise', hint: '6-10 chapters, only the major sections' },
  { id: 'balanced', label: 'Balanced', hint: '10-16 chapters covering each real topic shift' },
  { id: 'detailed', label: 'Detailed', hint: '16-25 chapters, granular per sub-topic' },
];

// Keep only lines that look like "HH:MM:SS  Title" or "MM:SS  Title"
const cleanChapters = (raw: string): string => {
  const lines = raw.split('\n').map(l => l.trim())
    .map(l => l.replace(/^\s*(?:\d+[.)\]]|[-*•])\s*/, '')) // strip bullets/numbering
    .filter(l => /^\d{1,2}:\d{2}(?::\d{2})?/.test(l));
  return lines.join('\n');
};

const ChapterMaker: React.FC = () => {
  const [url, setUrl] = useState('');
  const [transcript, setTranscript] = useState('');
  const [needPaste, setNeedPaste] = useState(false);
  const [detail, setDetail] = useState('balanced');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [chapters, setChapters] = useState('');
  const [copied, setCopied] = useState(false);

  const run = useCallback(async () => {
    setNote(null);
    const id = extractYouTubeId(url.trim());
    if (!id) { setNote('Paste a valid YouTube link.'); return; }
    setBusy(true);

    let context = '';
    let duration = '';
    const segs = await fetchTranscript(id).catch(() => null);
    if (segs && segs.length) {
      context = segmentsToText(segs).slice(0, 24000);
      duration = formatTime(segs[segs.length - 1].start);
      setNeedPaste(false);
    } else if (transcript.trim()) {
      context = transcript.trim().slice(0, 24000);
    } else {
      setNeedPaste(true);
      setBusy(false);
      setNote('No captions found for this video. Paste the timestamped transcript below and try again.');
      return;
    }

    const detailHint = DETAIL.find(d => d.id === detail)?.hint || '';
    const prompt = `You are a YouTube chapters editor. Using the TIMESTAMPED transcript below, create clean video chapters.
Requirements:
- ${detailHint}.
- The FIRST chapter MUST be "00:00:00  Intro".
- Use the real timestamps from the transcript; place each chapter at the moment that topic actually begins.
- Format EVERY line exactly as: HH:MM:SS<two spaces>Short descriptive title (Title Case, no ending punctuation).
- Titles must be specific to the content, not generic. Cover the whole video${duration ? ` (~${duration} long)` : ''} in chronological order.
- Output ONLY the chapter lines. No intro text, no numbering, no markdown.

TRANSCRIPT:
${context}`;

    try {
      const out = await generateText(prompt);
      const cleaned = cleanChapters(out);
      if (!cleaned) { setNote('Could not build chapters. Try again or paste a fuller transcript.'); }
      setChapters(cleaned || '');
    } catch (e: any) {
      setNote(e?.message?.slice(0, 140) || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }, [url, transcript, detail]);

  const copyAll = () => {
    navigator.clipboard?.writeText(chapters);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const lines = chapters ? chapters.split('\n') : [];

  return (
    <div className="grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-6 lg:gap-8 items-start max-w-6xl mx-auto">
      {/* ── Controls ── */}
      <div className="thumb-glass rounded-3xl p-5 sm:p-6 space-y-5 lg:sticky lg:top-24">
        <div className="flex items-center gap-3">
          <div className="thumb-btn w-11 h-11 rounded-2xl flex items-center justify-center text-white shrink-0"><Ic.List className="w-5 h-5" /></div>
          <div>
            <h2 className="text-lg font-black text-thumb-ink leading-tight">Chapter Maker</h2>
            <p className="text-[13px] text-thumb-sub">Paste a link → timestamped chapters</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">YouTube link</label>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 text-sm text-thumb-ink placeholder:text-thumb-sub/60 focus:border-thumb-red/50 outline-none transition-colors"
          />
          <p className="text-[12px] text-thumb-sub">We analyze the video's captions and mark where each topic starts.</p>
        </div>

        {needPaste && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Transcript (with timestamps)</label>
            <textarea
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              rows={5}
              placeholder="[00:00] intro… [01:20] next topic…"
              className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 text-sm text-thumb-ink placeholder:text-thumb-sub/60 focus:border-thumb-red/50 outline-none transition-colors resize-none"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Detail</label>
          <div className="flex gap-1 p-1 bg-thumb-soft border border-thumb-line rounded-xl">
            {DETAIL.map(d => (
              <button key={d.id} type="button" onClick={() => setDetail(d.id)} className={`flex-1 py-1.5 rounded-lg text-[13px] font-bold transition-all ${detail === d.id ? 'thumb-liquid' : 'text-thumb-sub hover:text-thumb-ink'}`}>{d.label}</button>
            ))}
          </div>
        </div>

        {note && <div className="text-xs bg-thumb-redSoft text-red-300 border border-thumb-red/20 rounded-xl px-4 py-3 leading-relaxed">{note}</div>}

        <button onClick={run} disabled={busy} className="thumb-btn w-full py-4 rounded-2xl text-white font-black text-lg flex items-center justify-center gap-3 disabled:text-white/70">
          {busy ? <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Analyzing video…</> : <><Ic.Wand className="w-5 h-5" /> Generate Chapters</>}
        </button>
      </div>

      {/* ── Results ── */}
      <div className="thumb-glass rounded-3xl p-5 sm:p-6 min-h-[420px]">
        {lines.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-thumb-ink uppercase tracking-wider">Chapters <span className="text-thumb-sub font-bold">· {lines.length}</span></h3>
              <button onClick={copyAll} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${copied ? 'bg-thumb-greenSoft text-thumb-green border border-thumb-green/30' : 'bg-thumb-soft border border-thumb-line text-thumb-ink hover:border-thumb-red/40'}`}>
                {copied ? <><Ic.Check className="w-3.5 h-3.5" /> Copied</> : <><Ic.Copy className="w-3.5 h-3.5" /> Copy all</>}
              </button>
            </div>
            <div className="space-y-0.5">
              {lines.map((l, i) => {
                const m = l.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/);
                const time = m ? m[1] : '';
                const title = m ? m[2] : l;
                return (
                  <div key={i} className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-thumb-soft/60 transition-colors">
                    <span className="shrink-0 font-mono text-[13px] font-bold text-thumb-red tabular-nums pt-0.5 flex items-center gap-1.5"><Ic.Clock className="w-3.5 h-3.5 opacity-70" />{time}</span>
                    <span className="text-[15px] text-thumb-ink font-medium leading-snug">{title}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[12px] text-thumb-sub pt-1">Paste these straight into your video description — YouTube turns them into clickable chapters.</p>
          </div>
        ) : (
          <div className="h-full min-h-[380px] flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center mb-4"><Ic.List className="w-7 h-7" /></div>
            <h3 className="text-lg font-black text-thumb-ink">Chapters show up here</h3>
            <p className="text-sm text-thumb-sub mt-2 max-w-xs">Paste a YouTube link on the left and hit <span className="font-bold text-thumb-ink">Generate</span> — timestamps are auto-detected.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChapterMaker;
