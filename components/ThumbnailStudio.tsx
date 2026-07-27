import React, { useState, useRef, useCallback } from 'react';
import { GeneratedImage, QueueItem, ThumbInputMode, THUMBNAIL_TEMPLATES } from '../types';

// ── Inline icons (red-theme, self-contained) ──────────────────────
const I = {
  Wand: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" /></svg>),
  Youtube: (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M23 12s0-3.3-.4-4.9a2.5 2.5 0 0 0-1.8-1.8C19.2 5 12 5 12 5s-7.2 0-8.8.4A2.5 2.5 0 0 0 1.4 7.2C1 8.7 1 12 1 12s0 3.3.4 4.9a2.5 2.5 0 0 0 1.8 1.8C4.8 19 12 19 12 19s7.2 0 8.8-.4a2.5 2.5 0 0 0 1.8-1.8C23 15.3 23 12 23 12zM9.8 15.3V8.7l6 3.3-6 3.3z" /></svg>),
  Grid: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>),
  Text: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 7V5h16v2M9 19h6M12 5v14" /></svg>),
  Image: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>),
  Upload: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" /></svg>),
  Download: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>),
  Edit: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>),
  Trash: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>),
  X: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M18 6 6 18M6 6l12 12" /></svg>),
  Eye: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>),
  Star: (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2l3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1L12 2z" /></svg>),
  Menu: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...p}><path d="M3 6h18M3 12h18M3 18h18" /></svg>),
  Bolt: (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>),
};

// ── Prompt composition ────────────────────────────────────────────
const BASE_THUMB = 'Design a professional, scroll-stopping YouTube thumbnail in 16:9 landscape. Ultra sharp, high dynamic range, dramatic studio lighting, punchy saturated colors, and strong contrast so it stands out even at small sizes. One clear focal point, rule-of-thirds composition, clean depth. No watermarks or logos.';

const textDirective = (t: string) =>
  t.trim()
    ? `Add bold, chunky, EXTRA-LARGE uppercase title text reading exactly "${t.trim()}", with a thick contrasting outline and drop shadow, placed for maximum readability without covering the subject's face.`
    : 'Keep any text minimal and clean.';

// Extract the 11-char YouTube video id from most URL shapes
export const extractYouTubeId = (url: string): string | null => {
  const m = url.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};

// Fetch an existing YouTube thumbnail as a base64 reference (best quality available)
const fetchYouTubeThumb = async (id: string): Promise<string | null> => {
  const qualities = ['maxresdefault', 'sddefault', 'hqdefault'];
  for (const q of qualities) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${id}/${q}.jpg`);
      if (!res.ok) continue;
      const blob = await res.blob();
      // hqdefault always exists (120x90 grey placeholder is ~1KB); skip tiny/empty ones
      if (blob.size < 3000 && q !== 'hqdefault') continue;
      return await new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
      });
    } catch {
      /* try next quality */
    }
  }
  return null;
};

interface Props {
  onGenerate: (prompt: string, sources: string[]) => void;
  generatedImages: GeneratedImage[];
  queue: QueueItem[];
  isProcessing: boolean;
  itemTimers: Record<string, number>;
  onView: (url: string) => void;
  onDownload: (url: string) => void;
  onDownloadAll: () => void;
  onDelete: (id: string) => void;
  onOpenEditor: (url?: string) => void;
}

const TABS: { id: ThumbInputMode; label: string; icon: (p: any) => React.ReactElement }[] = [
  { id: 'youtube', label: 'YouTube Link', icon: I.Youtube },
  { id: 'templates', label: 'Templates', icon: I.Grid },
  { id: 'prompt', label: 'Prompt', icon: I.Text },
  { id: 'reference', label: 'Reference + Text', icon: I.Image },
];

const RATINGS = [
  { src: 'G', label: 'Google', score: '4.8', reviews: '+1200', color: '#4285F4', star: 'text-amber-400' },
  { src: '★', label: 'Trustpilot', score: '4.6', reviews: '+620', color: '#00b67a', star: 'text-emerald-500' },
  { src: 'G²', label: 'G2', score: '4.7', reviews: '+80', color: '#ff492c', star: 'text-orange-500' },
];

const ThumbnailStudio: React.FC<Props> = ({
  onGenerate, generatedImages, queue, isProcessing, itemTimers,
  onView, onDownload, onDownloadAll, onDelete, onOpenEditor,
}) => {
  const [mode, setMode] = useState<ThumbInputMode>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [titleText, setTitleText] = useState('');
  const [promptText, setPromptText] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>(THUMBNAIL_TEMPLATES[0].id);
  const [uploads, setUploads] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const readFiles = (files: File[]) => {
    files.filter(f => f.type.startsWith('image/')).forEach(file => {
      const r = new FileReader();
      r.onload = e => {
        if (e.target?.result) setUploads(prev => [...prev, e.target!.result as string].slice(0, 4));
      };
      r.readAsDataURL(file);
    });
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) readFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const canGenerate = (() => {
    if (busy) return false;
    if (mode === 'youtube') return extractYouTubeId(youtubeUrl) !== null;
    if (mode === 'templates') return titleText.trim().length > 0;
    if (mode === 'prompt') return promptText.trim().length > 0;
    if (mode === 'reference') return uploads.length > 0 || promptText.trim().length > 0;
    return false;
  })();

  const scrollToResults = () =>
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setNote(null);
    let prompt = '';
    let sources: string[] = [...uploads];

    if (mode === 'youtube') {
      const id = extractYouTubeId(youtubeUrl);
      if (!id) return;
      setBusy(true);
      const thumb = await fetchYouTubeThumb(id);
      setBusy(false);
      if (thumb) {
        sources = [thumb, ...sources];
        prompt = `Using the uploaded YouTube thumbnail as reference for the subject and topic, create a fresh, more click-worthy version that keeps the same theme but is far more eye-catching. ${textDirective(titleText)} ${BASE_THUMB}`;
      } else {
        setNote('Could not fetch that video\'s thumbnail (private/unavailable). Generating from your title instead — add a title below for best results.');
        if (!titleText.trim()) { return; }
        prompt = `Create a viral YouTube thumbnail about "${titleText.trim()}". ${textDirective(titleText)} ${BASE_THUMB}`;
      }
    } else if (mode === 'templates') {
      const tpl = THUMBNAIL_TEMPLATES.find(t => t.id === selectedTemplate)!;
      const topic = titleText.trim();
      prompt = `${tpl.style} The video is about "${topic}". ${sources.length ? 'Feature the person/photo from the uploaded reference as the main subject and preserve their likeness. ' : ''}${textDirective(titleText)} ${BASE_THUMB}`;
    } else if (mode === 'prompt') {
      prompt = `${promptText.trim()}. ${textDirective(titleText)} ${BASE_THUMB}`;
    } else {
      // reference
      const extra = promptText.trim() ? `Additional direction: ${promptText.trim()}. ` : '';
      prompt = `Using the uploaded reference image(s) as strong inspiration for style, mood and composition, create a brand-new original thumbnail (do not copy it exactly). ${uploads.length ? 'If a person appears, preserve their likeness. ' : ''}${extra}${textDirective(titleText)} ${BASE_THUMB}`;
    }

    onGenerate(prompt, sources);
    scrollToResults();
  }, [canGenerate, mode, uploads, youtubeUrl, titleText, promptText, selectedTemplate, onGenerate]);

  const sortedQueue = [...queue].sort((a, b) =>
    a.status === 'failed' ? 1 : b.status === 'failed' ? -1 : 0);

  return (
    <div className="thumb-scope min-h-screen bg-thumb-bg text-thumb-ink font-sans antialiased">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-thumb-bg/90 backdrop-blur-xl border-b border-thumb-line">
        <div className="max-w-6xl mx-auto px-5 h-[68px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-thumb-red to-thumb-redDark flex items-center justify-center text-white shadow-lg shadow-thumb-red/30">
              <I.Wand className="w-5 h-5" />
            </div>
            <span className="text-xl font-extrabold tracking-tight">Thumbmagic</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => document.getElementById('thumb-tool')?.scrollIntoView({ behavior: 'smooth' })}
              className="thumb-cta-glow bg-gradient-to-b from-thumb-red to-thumb-redDark text-white font-bold text-sm px-5 py-2.5 rounded-full shadow-lg hover:brightness-105 transition-all"
            >
              Start now
            </button>
            <button className="p-2 text-thumb-ink/70 hover:text-thumb-ink" aria-label="Menu"><I.Menu className="w-6 h-6" /></button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5">
        {/* ── Hero ── */}
        <section className="pt-12 pb-6 text-center">
          <h1 className="text-[2.6rem] sm:text-6xl font-black leading-[1.05] tracking-tight max-w-3xl mx-auto">
            Create viral thumbnails <span className="text-thumb-red">instantly</span> that boost your views
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-thumb-sub max-w-2xl mx-auto leading-relaxed">
            Generate studio-quality YouTube &amp; Shorts thumbnails that stop scrolling and drive clicks in seconds. No design skills needed.
          </p>
        </section>

        {/* ── Generator tool ── */}
        <section id="thumb-tool" className="scroll-mt-24">
          <div className="bg-white border border-thumb-line rounded-3xl shadow-[0_20px_60px_-24px_rgba(245,51,76,0.35)] p-4 sm:p-7 max-w-3xl mx-auto">
            {/* Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-thumb-soft rounded-2xl">
              {TABS.map(t => {
                const active = mode === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setMode(t.id); setNote(null); }}
                    className={`flex items-center justify-center gap-2 py-2.5 px-2 rounded-xl text-[13px] font-bold transition-all ${
                      active ? 'bg-white text-thumb-red shadow-sm ring-1 ring-thumb-line' : 'text-thumb-sub hover:text-thumb-ink'
                    }`}
                  >
                    <t.icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Panels */}
            <div className="mt-6 space-y-4">
              {mode === 'youtube' && (
                <div className="space-y-3 animate-fade-in-up">
                  <label className="text-sm font-bold text-thumb-ink">Paste a YouTube video link</label>
                  <div className="flex items-center gap-2 bg-thumb-soft border border-thumb-line rounded-xl px-4 focus-within:ring-2 focus-within:ring-thumb-red/40">
                    <I.Youtube className="w-5 h-5 text-thumb-red shrink-0" />
                    <input
                      value={youtubeUrl}
                      onChange={e => setYoutubeUrl(e.target.value)}
                      placeholder="youtu.be/gO0bvT_smdM"
                      className="w-full bg-transparent py-3.5 outline-none text-[15px] placeholder-thumb-sub/60"
                    />
                  </div>
                  <p className="text-xs text-thumb-sub">We use the video's current thumbnail as a reference to make a better, higher-converting version.</p>
                </div>
              )}

              {mode === 'templates' && (
                <div className="space-y-3 animate-fade-in-up">
                  <label className="text-sm font-bold text-thumb-ink">Pick a style</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {THUMBNAIL_TEMPLATES.map(tpl => {
                      const active = selectedTemplate === tpl.id;
                      return (
                        <button
                          key={tpl.id}
                          onClick={() => setSelectedTemplate(tpl.id)}
                          className={`relative rounded-2xl overflow-hidden border-2 text-left transition-all ${
                            active ? 'border-thumb-red shadow-md' : 'border-transparent hover:border-thumb-line'
                          }`}
                          title={tpl.desc}
                        >
                          <div className={`h-14 bg-gradient-to-br ${tpl.swatch} flex items-center justify-center text-2xl`}>{tpl.emoji}</div>
                          <div className="px-2.5 py-2 bg-white">
                            <div className="text-xs font-bold leading-tight">{tpl.label}</div>
                            <div className="text-[10px] text-thumb-sub leading-tight mt-0.5 line-clamp-1">{tpl.desc}</div>
                          </div>
                          {active && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-thumb-red text-white flex items-center justify-center text-[11px] font-bold">✓</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {mode === 'prompt' && (
                <div className="space-y-3 animate-fade-in-up">
                  <label className="text-sm font-bold text-thumb-ink">Describe your thumbnail</label>
                  <textarea
                    value={promptText}
                    onChange={e => setPromptText(e.target.value)}
                    rows={3}
                    placeholder="e.g. A shocked gamer with glowing headset, explosion behind, neon RGB lighting..."
                    className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3.5 outline-none text-[15px] placeholder-thumb-sub/60 focus:ring-2 focus:ring-thumb-red/40 resize-none"
                  />
                </div>
              )}

              {mode === 'reference' && (
                <div className="space-y-3 animate-fade-in-up">
                  <label className="text-sm font-bold text-thumb-ink">Upload reference thumbnail(s) or your photo</label>
                  <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); readFiles(Array.from(e.dataTransfer.files)); }}
                    className="border-2 border-dashed border-thumb-line rounded-2xl p-6 flex flex-col items-center justify-center gap-2 text-thumb-sub hover:border-thumb-red hover:text-thumb-red cursor-pointer transition-all bg-thumb-soft"
                  >
                    <I.Upload className="w-7 h-7" />
                    <span className="text-sm font-semibold">Click or drag to upload (up to 4)</span>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
                  <textarea
                    value={promptText}
                    onChange={e => setPromptText(e.target.value)}
                    rows={2}
                    placeholder="Optional: extra direction (colors, mood, subject...)"
                    className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 outline-none text-sm placeholder-thumb-sub/60 focus:ring-2 focus:ring-thumb-red/40 resize-none"
                  />
                </div>
              )}

              {/* Uploaded thumbnails preview (shared for templates + reference) */}
              {(mode === 'reference' || mode === 'templates') && uploads.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {uploads.map((u, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-thumb-line group">
                      <img src={u} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => setUploads(prev => prev.filter((_, x) => x !== i))} className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><I.X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
              )}

              {/* Optional add-photo for templates */}
              {mode === 'templates' && uploads.length === 0 && (
                <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold text-thumb-red hover:underline flex items-center gap-1.5">
                  <I.Upload className="w-3.5 h-3.5" /> Add your face/photo (optional)
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
                </button>
              )}

              {/* Title / overlay text (all modes except pure prompt where it's optional) */}
              {mode !== 'prompt' && (
                <div className="space-y-2">
                  <label className="text-sm font-bold text-thumb-ink flex items-center justify-between">
                    <span>{mode === 'templates' ? 'Video topic / title text' : 'Title text on thumbnail'}</span>
                    <span className="text-xs font-normal text-thumb-sub">{mode === 'templates' ? 'required' : 'optional'}</span>
                  </label>
                  <input
                    value={titleText}
                    onChange={e => setTitleText(e.target.value)}
                    placeholder="e.g. THIS CHANGED EVERYTHING"
                    className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3.5 outline-none text-[15px] placeholder-thumb-sub/60 focus:ring-2 focus:ring-thumb-red/40"
                  />
                </div>
              )}
              {mode === 'prompt' && (
                <input
                  value={titleText}
                  onChange={e => setTitleText(e.target.value)}
                  placeholder="Optional: bold title text to render on the thumbnail"
                  className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 outline-none text-sm placeholder-thumb-sub/60 focus:ring-2 focus:ring-thumb-red/40"
                />
              )}

              {note && (
                <div className="text-xs bg-thumb-redSoft text-thumb-redDark rounded-xl px-4 py-3 leading-relaxed">{note}</div>
              )}

              {/* Generate */}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className={`thumb-cta-glow w-full py-4 rounded-2xl text-white font-black text-lg flex items-center justify-center gap-3 transition-all ${
                  canGenerate ? 'bg-gradient-to-b from-thumb-red to-thumb-redDark hover:brightness-105' : 'bg-thumb-sub/40 cursor-not-allowed !animate-none !shadow-none'
                }`}
              >
                {busy ? (
                  <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Fetching…</>
                ) : (
                  <><I.Wand className="w-5 h-5" /> Generate Thumbnails</>
                )}
              </button>
              <p className="text-center text-xs text-thumb-sub">Free to try • Downloads in full 16:9 HD</p>
            </div>
          </div>
        </section>

        {/* ── Results ── */}
        <section ref={resultsRef} className="scroll-mt-24 pt-12">
          {(generatedImages.length > 0 || queue.length > 0) && (
            <>
              <div className="flex items-center justify-between mb-5 max-w-5xl mx-auto">
                <h2 className="text-2xl font-black flex items-center gap-2">
                  {isProcessing ? <><span className="w-4 h-4 border-2 border-thumb-red border-t-transparent rounded-full animate-spin" /> Generating…</> : 'Your thumbnails'}
                </h2>
                {generatedImages.length > 0 && (
                  <button onClick={onDownloadAll} className="text-sm font-bold text-thumb-red flex items-center gap-1.5 hover:underline">
                    <I.Download className="w-4 h-4" /> Download all
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
                {sortedQueue.map(item => (
                  <div key={item.id} className="aspect-video rounded-2xl bg-thumb-soft border border-thumb-line flex flex-col items-center justify-center gap-2 overflow-hidden p-4 text-center">
                    {item.status === 'processing' ? (
                      <>
                        <span className="w-8 h-8 border-[3px] border-thumb-red border-t-transparent rounded-full animate-spin" />
                        <span className="text-thumb-red font-mono text-sm">{(itemTimers[item.id] || 0).toFixed(1)}s</span>
                      </>
                    ) : item.status === 'failed' ? (
                      <>
                        <div className="w-10 h-10 rounded-full bg-thumb-redSoft text-thumb-red flex items-center justify-center text-xl">!</div>
                        <span className="text-sm font-bold">Generation failed</span>
                        {item.error && <span className="text-[11px] text-thumb-sub line-clamp-2">{item.error}</span>}
                      </>
                    ) : (
                      <>
                        <span className="w-7 h-7 border-2 border-thumb-sub/40 border-dotted rounded-full animate-pulse" />
                        <span className="text-xs font-bold text-thumb-sub uppercase tracking-widest">Queued</span>
                      </>
                    )}
                  </div>
                ))}

                {generatedImages.map(img => (
                  <div key={img.id} className="group relative aspect-video rounded-2xl overflow-hidden border border-thumb-line bg-thumb-soft shadow-sm animate-fade-in-up">
                    <img src={img.url} alt={img.prompt} loading="lazy" className="w-full h-full object-cover cursor-pointer" onClick={() => onView(img.url)} />
                    <div className="absolute inset-x-0 bottom-0 p-2.5 flex gap-1.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => onView(img.url)} title="View" className="flex-1 py-2 rounded-lg bg-white/90 text-thumb-ink text-xs font-bold flex items-center justify-center hover:bg-white"><I.Eye className="w-4 h-4" /></button>
                      <button onClick={() => onOpenEditor(img.url)} title="Fine-tune in Nano Edit" className="flex-1 py-2 rounded-lg bg-thumb-red text-white text-xs font-bold flex items-center justify-center gap-1 hover:bg-thumb-redDark"><I.Edit className="w-4 h-4" /> Edit</button>
                      <button onClick={() => onDownload(img.url)} title="Download" className="flex-1 py-2 rounded-lg bg-white/90 text-thumb-ink text-xs font-bold flex items-center justify-center hover:bg-white"><I.Download className="w-4 h-4" /></button>
                      <button onClick={() => onDelete(img.id)} title="Delete" className="py-2 px-2.5 rounded-lg bg-white/90 text-thumb-red text-xs font-bold flex items-center justify-center hover:bg-white"><I.Trash className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ── Trust bar ── */}
        <section className="py-14">
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
            {RATINGS.map(r => (
              <div key={r.label} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-thumb-soft border border-thumb-line flex items-center justify-center font-black" style={{ color: r.color }}>{r.src}</div>
                <div>
                  <div className={`flex gap-0.5 ${r.star}`}>{[0,1,2,3,4].map(i => <I.Star key={i} className="w-4 h-4" />)}</div>
                  <div className="text-xs text-thumb-sub mt-0.5"><b className="text-thumb-ink">{r.score}</b>/5 · {r.reviews} reviews</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Feature strip ── */}
        <section className="pb-20 text-center">
          <p className="text-thumb-red font-black tracking-widest text-sm uppercase">Never miss clicks</p>
          <h2 className="text-3xl sm:text-4xl font-black mt-3 max-w-2xl mx-auto leading-tight">Get more clicks and views with high-converting thumbnails</h2>
          <div className="grid sm:grid-cols-3 gap-4 mt-10 max-w-4xl mx-auto text-left">
            {[
              { icon: I.Bolt, t: 'Seconds, not hours', d: 'Go from idea to finished thumbnail in one click — no Photoshop, no designer.' },
              { icon: I.Grid, t: 'Proven viral styles', d: 'Templates modeled on the thumbnails that top creators use to win the click.' },
              { icon: I.Edit, t: 'Fine-tune in Nano Edit', d: 'Send any result to the built-in editor to tweak text, background and more.' },
            ].map((f, i) => (
              <div key={i} className="bg-white border border-thumb-line rounded-2xl p-5 shadow-sm">
                <div className="w-11 h-11 rounded-xl bg-thumb-redSoft text-thumb-red flex items-center justify-center mb-4"><f.icon className="w-5 h-5" /></div>
                <h3 className="font-black text-lg">{f.t}</h3>
                <p className="text-sm text-thumb-sub mt-1.5 leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-thumb-line py-8 text-center text-xs text-thumb-sub">
        <button onClick={() => onOpenEditor()} className="font-semibold text-thumb-ink hover:text-thumb-red transition-colors">Open Nano Edit editor →</button>
        <p className="mt-2">Thumbmagic · powered by Nano Edit</p>
      </footer>
    </div>
  );
};

export default ThumbnailStudio;
