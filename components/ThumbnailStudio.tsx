import React, { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { GeneratedImage, QueueItem, ThumbInputMode, THUMBNAIL_TEMPLATES } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { Plan, BillingCycle } from '../services/plans';
import { buyItem } from '../services/paymentsService';
import { extractYouTubeId, urlToBase64, fetchYouTubeTitle, fetchYouTubeThumb } from '../services/youtubeService';
import AuthModal from './AuthModal';
import { I } from './ThumbIcons';
import ResultThumb from './ResultThumb';
import ChangeFaceModal from './ChangeFaceModal';
import SketchCanvas from './SketchCanvas';
import PersonaPicker from './PersonaPicker';
import StylePickerModal from './StylePickerModal';
import SegmentedControl from './SegmentedControl';
import { savePersona } from '../services/personasService';
// Secondary tabs load on demand — each becomes its own chunk, fetched only when
// the user opens that tab, so the initial studio view stays lean.
const Pricing = React.lazy(() => import('./Pricing'));
const Account = React.lazy(() => import('./Account'));
const TitleGenerator = React.lazy(() => import('./TitleGenerator'));
const ChapterMaker = React.lazy(() => import('./ChapterMaker'));
const AdminStyles = React.lazy(() => import('./AdminStyles'));

// Lightweight loader shown while a lazy tab chunk arrives (usually a few ms).
const PanelFallback = () => (
  <div className="flex items-center justify-center py-24">
    <div className="w-8 h-8 border-2 border-thumb-red border-t-transparent rounded-full animate-spin" />
  </div>
);
import { getFromLocalStorage, saveToLocalStorage } from '../services/storageService';
import { fetchTranscript, segmentsToText, generateText } from '../services/textService';
import { useStyleImages, matchStyles, fetchStyleImages, fetchMyStyles } from '../services/stylesService';

// Auto-load any real thumbnails dropped into attached_assets/showcase/ (16:9 jpg/png/webp).
// No code changes needed — just add image files and they appear in the showcase gallery.
const SHOWCASE_IMAGES = Object.entries(
  import.meta.glob('../attached_assets/showcase/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}', {
    eager: true, query: '?url', import: 'default',
  }) as Record<string, string>
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

// The home showcase marquee (below) shows SHOWCASE_IMAGES in two rows
// scrolling opposite ways. Splitting into disjoint odd/even sets — rather
// than both rows drawing from the full array — guarantees the same photo
// never appears in both rows at once (with a shared pool, a given image
// legitimately can and did line up in both rows at the same moment).
const SHOWCASE_ROW_1 = SHOWCASE_IMAGES.length > 1 ? SHOWCASE_IMAGES.filter((_, i) => i % 2 === 0) : SHOWCASE_IMAGES;
const SHOWCASE_ROW_2 = SHOWCASE_IMAGES.length > 1 ? SHOWCASE_IMAGES.filter((_, i) => i % 2 === 1) : SHOWCASE_IMAGES;

// Real reference thumbnails dropped straight into attached_assets/ (not in a
// subfolder). These become an image-driven "style" pool: pick one and the AI
// recreates a thumbnail in its exact look — no text style description needed.
export const REFERENCE_IMAGES = Object.entries(
  import.meta.glob('../attached_assets/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}', {
    eager: true, query: '?url', import: 'default',
  }) as Record<string, string>
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

// Real preview images for template cards. Drop a file named after the template id
// (e.g. attached_assets/templates/mrbeast.jpg) and that card shows the real thumbnail.
const TEMPLATE_PREVIEWS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../attached_assets/templates/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}', {
      eager: true, query: '?url', import: 'default',
    }) as Record<string, string>
  ).map(([path, url]) => [path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase(), url])
);

// The home showcase thumbnails double as ready-made template previews (in order).
const SHOWCASE_TEMPLATE_PREVIEWS: Record<string, string> = {
  'transform-split': SHOWCASE_IMAGES[0],
  'wild-survival': SHOWCASE_IMAGES[1],
  'jungle-danger': SHOWCASE_IMAGES[2],
  'expose-split': SHOWCASE_IMAGES[3],
  'character-render': SHOWCASE_IMAGES[4],
  'animated-expose': SHOWCASE_IMAGES[5],
};

// ── Prompt composition ────────────────────────────────────────────
// Every YouTube-mode image costs 3 credits instead of the normal 1 — that
// pipeline does real extra work per image (transcript fetch, concept LLM
// call, style-match embedding call, on top of the actual generation), so
// each result is priced to reflect that. The analysis itself (transcript +
// concepts) is free and still cached per video id — regenerating from the
// SAME link never re-runs it, but every image, cached-analysis or not,
// costs 3 credits; the server enforces this (sourceMode: 'youtube').
const YOUTUBE_IMAGE_COST = 3;
// Mirrors RES_SURCHARGE in supabase/functions/generate + api/generate — 4K
// costs extra credits server-side, so the pre-flight credit check here has to
// account for it too, or a user on 4K could pass this check and still hit a
// mid-batch 402 the server enforces anyway.
const RES_SURCHARGE_4K = 2;

const BASE_THUMB = 'Design a top-tier, agency-grade, scroll-stopping YouTube thumbnail in 16:9 landscape — match the production quality, polish and click-worthiness of the best viral thumbnails from the biggest creators. Unless a specific art style is explicitly requested, lean photorealistic and lifelike — real-camera depth of field, natural skin texture, and a sharp, detailed, expressive face with realistic lighting. Compose it in whatever way best suits the topic — a bold real scene, a dramatic environment, or a clean backdrop — with a strong, clear focal point and real depth; just avoid random, meaningless clutter. Depict the subject and topic accurately. Use dramatic lighting, punchy vibrant colors and strong contrast so it pops even at small sizes. Render at high fidelity — crisp, detailed and clean, with no blur, noise, artifacts, warping or distorted anatomy. Do not add extra text, letters, captions, subtitles, watermarks or gibberish beyond any text that is explicitly requested.';

// Vertical variant for YouTube Shorts / Reels / TikTok covers.
const BASE_SHORT = 'Design a bold, top-tier, agency-grade, scroll-stopping 9:16 VERTICAL cover for YouTube Shorts / Reels — match the production quality and polish of the best viral covers. Full-bleed vertical composition, the subject centred and large, filling the tall frame. Unless a specific art style is explicitly requested, lean photorealistic and lifelike — natural skin texture, a sharp detailed expressive face and realistic lighting. Compose it in whatever way best suits the topic — a bold real scene, a dramatic environment, or a clean backdrop — with a strong, clear focal point; just avoid random, meaningless clutter. Depict the subject and topic accurately. Use dramatic lighting, punchy vibrant colors and strong contrast so it pops on a phone screen. Render at high fidelity — crisp, detailed and clean, with no blur, noise, artifacts, warping or distorted anatomy. Keep the key subject and any text within the middle safe zone (away from the very top and bottom, which the app UI covers). Do not add extra text, letters, captions, subtitles, watermarks or gibberish beyond any text that is explicitly requested.';

// Topic-aware art direction — inspects the title/topic and returns a matching mood,
// palette and composition hint so the thumbnail fits the video instead of looking generic.
const TOPIC_HINTS: { re: RegExp; hint: string }[] = [
  { re: /\b(game|gaming|gameplay|minecraft|fortnite|gta|valorant|fps|roblox|pubg|bgmi)\b/i, hint: 'High-energy gaming look: vivid neon accents, glowing effects, dynamic action framing.' },
  { re: /\b(money|rich|income|invest|stock|crypto|bitcoin|business|profit|millionaire|earn)\b/i, hint: 'Wealth/finance look: gold and deep-green tones, cash/upward-arrow motifs, confident expression.' },
  { re: /\b(tech|iphone|android|gadget|ai|coding|developer|laptop|pc|review|unbox)\b/i, hint: 'Clean modern tech look: sleek gradients, cool blue/purple accents, crisp product focus.' },
  { re: /\b(fitness|gym|workout|muscle|bodybuild|weight ?loss|diet|abs)\b/i, hint: 'Fitness look: strong dramatic rim lighting, energetic pose, bold red/orange accents.' },
  { re: /\b(food|recipe|cook|cooking|eat|mukbang|kitchen|restaurant)\b/i, hint: 'Mouth-watering food look: warm appetizing light, tight close-up, glossy vivid colors.' },
  { re: /\b(travel|trip|tour|country|city|adventure|explore|journey|vlog)\b/i, hint: 'Travel look: stunning scenic backdrop, warm golden-hour light, sense of wonder.' },
  { re: /\b(horror|scary|ghost|haunted|creepy|nightmare|paranormal)\b/i, hint: 'Dark suspenseful horror look: moody shadows, cold eerie lighting, high tension.' },
  { re: /\b(kids|cartoon|toy|family|nursery|fun)\b/i, hint: 'Playful colorful look: bright cheerful palette, fun exaggerated expressions.' },
  { re: /\b(story|storytime|drama|exposed|expose|truth|shocking|secret|reaction)\b/i, hint: 'Dramatic storytelling look: expressive shocked face, bold arrows/circles highlighting the key element.' },
  { re: /\b(tutorial|how to|guide|learn|course|tips|hack)\b/i, hint: 'Clear educational look: clean layout, numbered/step feel, confident presenter, legible callouts.' },
];
// Sample a transcript across its WHOLE length instead of just its first N
// characters — a video's actual hook/dramatic moment can land anywhere
// (an early cold-open, a mid-video twist, an ending payoff), not only in
// the first couple of minutes a plain prefix-slice would capture. Splits
// into a handful of evenly-spaced chunks by segment index and takes an
// even slice of each, joined with a break so the model reads them as
// separate excerpts rather than one continuous passage.
const sampleTranscript = (segments: { start: number; text: string }[], maxChars: number): string => {
  const full = segmentsToText(segments);
  if (full.length <= maxChars) return full;
  const CHUNKS = 5;
  const perChunk = Math.max(1, Math.floor(segments.length / CHUNKS));
  const budget = Math.floor(maxChars / CHUNKS);
  const parts: string[] = [];
  for (let i = 0; i < CHUNKS; i++) {
    const start = i * perChunk;
    if (start >= segments.length) break;
    const end = i === CHUNKS - 1 ? segments.length : Math.min(segments.length, start + perChunk);
    const chunkText = segmentsToText(segments.slice(start, end)).slice(0, budget);
    if (chunkText) parts.push(chunkText);
  }
  return parts.join('\n[…]\n');
};


const topicDirective = (topic: string) => {
  const t = topic.trim();
  if (!t) return '';
  const hit = TOPIC_HINTS.find(h => h.re.test(t));
  return hit ? `${hit.hint} ` : '';
};

// Decides the on-thumbnail text: whether to show it, how much, and its treatment.
// Default text color is always WHITE with a heavy black outline for max legibility.
const textDirective = (t: string) => {
  const raw = t.trim();
  if (!raw) {
    // No title supplied → keep the image completely text-free so the model
    // never bolts on a stray, garbled "extra text layer".
    return 'Do NOT render any text, words, letters, captions, labels, numbers or watermarks anywhere on the image — keep it completely clean and text-free.';
  }
  const long = raw.split(/\s+/).length > 5;
  const hook = long
    ? `distill the idea into a punchy 2-4 word hook (do NOT paste the whole sentence)`
    : `use it exactly as "${raw}"`;
  return `Overlay ONE bold, chunky, EXTRA-LARGE uppercase title text — ${hook}. The text color MUST be pure white with a thick solid black outline and a strong drop shadow for maximum contrast. Place it clear of the subject's face and keep it to at most one third of the frame. Render ONLY this single piece of text — absolutely no other words, duplicate captions, subtitles, stray letters or gibberish anywhere else on the image.`;
};

// Quality tiers exposed in the UI, mapped to what the backend actually needs:
// the image model tier (flash = fast/1K-only; pro = the model that honours
// 2K/4K) AND the exact resolution to request from it. Explicit resolution
// labels (2K/4K) instead of a vague "Fast/Pro" toggle — 4K was already the
// resolution the homepage advertises, but the old toggle never actually
// requested it.
type QualityTier = 'fast' | '2k' | '4k';
const QUALITY_RESOLUTION: Record<QualityTier, '1K' | '2K' | '4K'> = { fast: '1K', '2k': '2K', '4k': '4K' };
const QUALITY_MODEL: Record<QualityTier, 'flash' | 'pro'> = { fast: 'flash', '2k': 'pro', '4k': 'pro' };

interface Props {
  onGenerate: (prompt: string, sources: string[], opts?: { count?: number; modelType?: 'flash' | 'pro'; resolution?: '1K' | '2K' | '4K'; aspect?: string; sourceMode?: 'youtube' }) => void;
  generatedImages: GeneratedImage[];
  queue: QueueItem[];
  isProcessing: boolean;
  itemTimers: Record<string, number>;
  onView: (url: string) => void;
  onDownload: (url: string) => void;
  onDownloadAll: () => void;
  onDelete: (id: string) => void;
  onOpenEditor: (url?: string) => void;
  onRetry: (item: QueueItem) => void;
  onCancel: (id: string) => void;
  // Lifted to App (rather than local state) so the Studio's own lightbox
  // there can also trigger "Change face" on the same image, not just the
  // per-card button in the results grid below.
  changeFaceTarget: string | null;
  setChangeFaceTarget: (url: string | null) => void;
}

const TABS: { id: ThumbInputMode; label: string; icon: (p: any) => React.ReactElement }[] = [
  { id: 'youtube', label: 'YouTube', icon: I.Youtube },
  { id: 'templates', label: 'Styles', icon: I.Grid },
  { id: 'sketch', label: 'Sketch', icon: I.Brush },
  { id: 'prompt', label: 'Prompt', icon: I.Text },
  { id: 'reference', label: 'Image', icon: I.Image },
];

const TESTIMONIALS = [
  { name: 'Rico Griek', loc: 'Netherlands', avatar: 'https://randomuser.me/api/portraits/men/32.jpg', title: 'Thumbnails that finally match my vision', body: 'It was always hard to make thumbnails that fit what I pictured. Now I paste a link, pick a style, and get click-worthy results in seconds.' },
  { name: 'Sidharth Das', loc: 'United States', avatar: 'https://randomuser.me/api/portraits/men/75.jpg', title: 'A time & money saver for a small YouTuber', body: 'A total godsend. I\'ve used it for a month now and the results are super impressive — it saves me the whole design headache.' },
  { name: 'Dan Kieft', loc: 'United Kingdom', avatar: 'https://randomuser.me/api/portraits/men/18.jpg', title: 'Great for thumbnail ideation', body: 'Even when I want to design myself, it gives me strong directions fast. My CTR is noticeably up since I started.' },
];

const FAQS = [
  { q: 'What is PodcastFlux?', a: 'PodcastFlux is an AI thumbnail maker for YouTube. Describe your idea, upload a photo, or paste a video link, and it generates high-converting HD 16:9 thumbnails in seconds — no design skills or editing apps needed.' },
  { q: 'How is this different from other thumbnail makers?', a: 'Most tools hand you a template to edit by hand. PodcastFlux is a true AI thumbnail generator — it designs the whole thumbnail for you (layout, background, and text) and keeps your face when you upload one.' },
  { q: 'Do I need design skills to use it?', a: 'No. Everything works through simple prompts, templates, and text-based edits. You describe what you want and the AI handles the design and execution.' },
  { q: 'Can I use it with my own face?', a: 'Yes. Upload your photo in Reference or Templates mode and the AI keeps your likeness while building a fresh, high-converting thumbnail around it.' },
  { q: 'How does the YouTube link option work?', a: 'Paste any video link and we pull its current thumbnail as a reference, then generate improved, more click-worthy versions that keep the same theme.' },
  { q: 'What size are the thumbnails?', a: 'Full 16:9 HD, ready to upload straight to YouTube. Every result downloads at high resolution with no watermark.' },
  { q: 'Can I edit a thumbnail after generating?', a: 'Yes. Send any result to the built-in editor to tweak text, swap backgrounds, brush-select areas, remove background, and more.' },
  { q: 'Is PodcastFlux really free to use?', a: 'Yes — new accounts start on a free plan with generation credits included, so you can try the AI thumbnail maker at no cost before upgrading for more credits.' },
  { q: 'Can it also generate YouTube titles and timestamps?', a: 'Yes. Paste a YouTube video link into the Title Generator for AI-written, click-worthy titles, or into the Chapter Maker to auto-generate accurate timestamps — both free tools built into PodcastFlux alongside the thumbnail maker.' },
];

// Steps shown while a thumbnail is being generated (advance ~every 4s of elapsed time)
const GEN_STEPS = ['Understanding your idea', 'Composing the scene', 'Rendering in HD', 'Adding final polish'];

// Neighboring cards used to give the YouTube feed preview realistic context
const FEED_NEIGHBORS = [
  { title: 'I Survived 50 Hours In A Desert', channel: 'Wildside', meta: '2.1M views · 3 days ago', dur: '18:24', hue: 'from-orange-400 to-rose-500', av: 'bg-orange-500', logo: '🏜️' },
  { title: 'The Truth About Passive Income (Honest)', channel: 'Money Lab', meta: '842K views · 1 week ago', dur: '12:06', hue: 'from-emerald-400 to-teal-600', av: 'bg-emerald-600', logo: '💰' },
  { title: 'Building My Dream Setup From Scratch', channel: 'TechDen', meta: '1.4M views · 5 days ago', dur: '24:51', hue: 'from-indigo-400 to-violet-600', av: 'bg-indigo-600', logo: '🖥️' },
  { title: 'Is This Proof That He Cheated?', channel: 'ChessNerd', meta: '1M views · 3 years ago', dur: '14:57', hue: 'from-slate-400 to-zinc-600', av: 'bg-zinc-600', logo: '♟️' },
  { title: 'World\'s Largest Bowl Of Cereal', channel: 'MrFeast', meta: '9.4M views · 2 days ago', dur: '10:02', hue: 'from-red-400 to-rose-600', av: 'bg-red-500', logo: '🥣' },
];

const ThumbnailStudio: React.FC<Props> = ({
  onGenerate, generatedImages, queue, isProcessing, itemTimers,
  onView, onDownload, onDownloadAll, onDelete, onOpenEditor, onRetry, onCancel,
  changeFaceTarget, setChangeFaceTarget,
}) => {
  const [mode, setMode] = useState<ThumbInputMode>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  // Set by startFromHome() when a YouTube link was pasted straight into the
  // home-page box, so Generate fires automatically once the YouTube flow's
  // state (mode/youtubeUrl) has actually committed — calling handleGenerate()
  // synchronously right after setYoutubeUrl/setMode would still see the OLD
  // pre-update values (React state updates aren't applied until the next
  // render), so a plain prompt string generates immediately inline but this
  // path needs one render cycle before it's safe to call handleGenerate.
  const [autoGenerateOnEntry, setAutoGenerateOnEntry] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [promptText, setPromptText] = useState('');
  // Advanced's "Describe what you want" is direction for ONE specific video
  // ("put THIS text on the thumbnail", "show his face on the left"…). Pasting
  // a different link and silently carrying that over produces thumbnails for
  // the new video still built around the old one's instructions. Clear it when
  // the link actually switches to a different video — only between two real
  // videos, so typing direction first and pasting the link after still works,
  // and so the other modes (which share this field) are never touched.
  const lastYtIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'youtube') return;
    const id = extractYouTubeId(youtubeUrl);
    const prev = lastYtIdRef.current;
    if (id && prev && id !== prev) setPromptText('');
    if (id) lastYtIdRef.current = id;
  }, [youtubeUrl, mode]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(THUMBNAIL_TEMPLATES[0].id);
  // The Styles tab has a single picker: pick a REAL thumbnail and the AI recreates
  // its exact look for your topic. Default to the first one so a style is always set.
  // The pool comes from the DB (falls back to the bundled REFERENCE_IMAGES) — only
  // fetched once this tab is actually opened, not on every visit to the studio.
  const styleImages = useStyleImages(REFERENCE_IMAGES, mode === 'templates' || mode === 'youtube' || mode === 'sketch');
  const [selectedRef, setSelectedRef] = useState<string | null>(REFERENCE_IMAGES[0] ?? null);
  // Keep a valid default selected as the DB pool loads / changes.
  useEffect(() => {
    if (styleImages.length && (!selectedRef || !styleImages.includes(selectedRef))) {
      setSelectedRef(styleImages[0]);
    }
  }, [styleImages, selectedRef]);
  const [uploads, setUploads] = useState<string[]>([]);
  const [sketchData, setSketchData] = useState<string | null>(null);
  const [selectedSketchStyle, setSelectedSketchStyle] = useState<string | null>(null);
  // Persona/Style popups are shared across Sketch and YouTube Advanced —
  // only one of those sections is ever visible at a time, and each has its
  // own "Persona"/"Style" button that just opens the matching popup directly
  // (no inline panel to toggle first).
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [styleModalOpen, setStyleModalOpen] = useState<'sketch' | 'youtube' | null>(null);
  const [ytAdvanced, setYtAdvanced] = useState(false);
  const [sketchAdvanced, setSketchAdvanced] = useState(false);
  const [templatesAdvanced, setTemplatesAdvanced] = useState(false);
  const [promptAdvanced, setPromptAdvanced] = useState(false);
  const [referenceAdvanced, setReferenceAdvanced] = useState(false);
  // YouTube mode normally auto-matches a style per video (vector search over
  // the style pool) — this lets a user override that and force one specific
  // style instead, same picker as the Styles tab. null = keep auto-matching.
  const [selectedYtStyle, setSelectedYtStyle] = useState<string | null>(null);
  // Restricts auto-style-matching to just the caller's own uploaded custom
  // styles (Account page), excluding the global pool entirely. Irrelevant
  // once a specific style is force-picked above (selectedYtStyle skips
  // matching altogether).
  const [onlyMyStyles, setOnlyMyStyles] = useState(false);
  // Pushes both the AI concepts and the final render toward a bolder,
  // more visually unique/dramatic take on the topic (shock-value staging,
  // unexpected composition) — off by default since it's less predictable
  // than the standard photorealistic path.
  const [creativeMode, setCreativeMode] = useState(false);
  // YouTube-only: ground concepts strictly in the transcript's actual main
  // topics instead of one loosely-inspired vivid scene — off by default
  // since the freer, more vivid-scene concept style is still the default.
  const [accurateMode, setAccurateMode] = useState(false);
  const [genCount, setGenCount] = useState(2);
  // Default to Pro (Nano Banana Pro / gemini-3-pro-image) — same 1-credit cost as Fast
  // but far higher fidelity, which is what makes results match the reference thumbnails.
  const [genModel, setGenModel] = useState<QualityTier>('2k');
  const [format, setFormat] = useState<'thumb' | 'short'>('thumb'); // 16:9 thumbnail vs 9:16 Shorts
  const [busy, setBusy] = useState(false);
  type Note = { text: string; kind: 'error' | 'success' | 'info' };
  const [note, setNote] = useState<Note | null>(null);
  const setNoteText = (text: string, kind: Note['kind'] = 'error') => setNote({ text, kind });
  // Raw fetch (thumbnail/title/transcript) cached per video id — this data never
  // changes for a given video, and the transcript fetch is separately
  // rate-limited (Supadata-backed), so re-generating from the SAME link reuses
  // it instead of re-fetching. The AI concept (conceptA/conceptB/headline) is
  // NOT cached here — it's a free (0-credit) operation, so it's regenerated
  // fresh on every Generate click for more variety instead of going stale.
  const ytFetchCache = useRef<Record<string, [string | null, string | null, Awaited<ReturnType<typeof fetchTranscript>>]>>({});
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [legal, setLegal] = useState<null | 'about' | 'privacy' | 'terms'>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Lock background scroll while the sidebar (mobile drawer) is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (sidebarOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [sidebarOpen]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => getFromLocalStorage('nano_theme', 'light'));
  useEffect(() => { saveToLocalStorage('nano_theme', theme); }, [theme]);

  // Warm the lazy tab chunks during browser idle time. The initial view paints
  // with only its critical JS; these prefetch quietly in the background so that
  // switching to a tab resolves instantly from cache — the user never waits.
  useEffect(() => {
    const prefetch = () => {
      import('./Pricing');
      import('./Account');
      import('./TitleGenerator');
      import('./ChapterMaker');
    };
    const ric = (window as any).requestIdleCallback as
      | ((cb: () => void, opts?: { timeout: number }) => number)
      | undefined;
    const cancel = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
    const id = ric ? ric(prefetch, { timeout: 4000 }) : window.setTimeout(prefetch, 2500);
    return () => { if (ric && cancel) cancel(id); else clearTimeout(id); };
  }, []);
  // Landing ('home') vs generator ('generate') vs feed preview ('preview') vs pricing
  const [section, setSection] = useState<'home' | 'generate' | 'preview' | 'title' | 'chapters' | 'pricing' | 'account' | 'admin'>('home');

  // Auth + billing
  const { user, profile, totalCredits, creditsLoading, signOut, configured, refreshProfile } = useAuth();
  // Lets the checkout-return poll below (a long-lived effect closure with an
  // empty dep array) read the LATEST totalCredits on each iteration instead
  // of the stale value captured when the effect first ran.
  const totalCreditsRef = useRef(totalCredits);
  useEffect(() => { totalCreditsRef.current = totalCredits; }, [totalCredits]);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReason, setAuthReason] = useState<string | undefined>(undefined);

  const requireLogin = (reason?: string) => { setAuthReason(reason); setAuthOpen(true); };

  const goPricing = () => {
    setSection('pricing');
    setSidebarOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

  const goAccount = () => {
    if (configured && !user) { requireLogin('Log in to see your account.'); return; }
    setSection('account');
    setSidebarOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

  // Real gate is server-side (admin-styles Edge Function re-checks is_admin on
  // every call) — this just avoids showing the nav entry/page to non-admins.
  const goAdmin = () => {
    if (!profile?.is_admin) return;
    setSection('admin');
    setSidebarOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

  // Dodo redirects back here after checkout (return_url set in
  // create-checkout) — there's no client-side "payment succeeded" callback
  // like Razorpay had, since crediting happens purely via the "dodo-webhook"
  // Edge Function, which can land a second or two after the browser's own
  // redirect. Poll the profile until the credited amount actually shows up,
  // instead of leaving the user staring at a stale balance.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('dodo_checkout') !== 'return') return;
    window.history.replaceState(null, '', window.location.pathname);
    goPricing();
    setNoteText('Finalizing your purchase…', 'info');

    const before = totalCredits;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 8 && !cancelled; i++) {
        await new Promise(r => setTimeout(r, 1500));
        await refreshProfile().catch(() => {});
        if (cancelled) return;
        if (totalCreditsRef.current > before) {
          setNoteText("You're all set — credits have been added!", 'success');
          return;
        }
      }
      if (!cancelled) {
        setNoteText("Still finalizing your purchase — if credits don't show up in a minute, contact support.", 'info');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dodo Payments checkout — creates a server-side checkout session and
  // navigates the browser to Dodo's hosted checkout page (see
  // paymentsService.ts). There's no "success" branch here: on success the
  // page navigates away entirely before this promise would resolve. Dodo
  // redirects back to `?dodo_checkout=return`, handled by the effect below,
  // which shows the success note once the webhook has actually granted the
  // credits — a failure here only ever means checkout couldn't even start.
  const startCheckout = async (plan: Plan, cycle: BillingCycle) => {
    if (!user || !supabase) { requireLogin('Log in to upgrade.'); return; }
    try {
      await buyItem(`plan:${plan.id}:${cycle}`);
    } catch (e: any) {
      setNoteText(e?.message || 'Could not start checkout. Please try again.');
    }
  };

  const buyAddon = async (addonId: string) => {
    if (!user || !supabase) { requireLogin('Log in to buy credits.'); return; }
    try {
      await buyItem(`addon:${addonId}`);
    } catch (e: any) {
      setNoteText(e?.message || 'Could not start checkout. Please try again.');
    }
  };

  // YouTube feed preview
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewDark, setPreviewDark] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewChannel, setPreviewChannel] = useState('Your Channel');
  const previewFileRef = useRef<HTMLInputElement>(null);
  // A/B compare — put two thumbnails side by side in the feed to judge which is clickier
  const [compareMode, setCompareMode] = useState(false);
  const [previewImageB, setPreviewImageB] = useState<string | null>(null);
  const [winner, setWinner] = useState<'A' | 'B' | null>(null);
  const previewFileRefB = useRef<HTMLInputElement>(null);

  const readPreviewFile = (e: React.ChangeEvent<HTMLInputElement>, set: (v: string) => void) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = ev => { if (ev.target?.result) set(ev.target.result as string); };
      r.readAsDataURL(file);
    }
    e.target.value = '';
  };
  const handlePreviewUpload = (e: React.ChangeEvent<HTMLInputElement>) => readPreviewFile(e, setPreviewImage);
  const handlePreviewUploadB = (e: React.ChangeEvent<HTMLInputElement>) => readPreviewFile(e, setPreviewImageB);

  const goHome = () => {
    setSection('home');
    setSidebarOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

  const goGenerate = () => {
    setSection('generate');
    setNote(null);
    setSidebarOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

  const goTitle = () => {
    setSection('title');
    setSidebarOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

  const goChapters = () => {
    setSection('chapters');
    setSidebarOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

  const goPreview = () => {
    setSection('preview');
    setSidebarOpen(false);
    // Auto-fill with the latest generated thumbnail if none is chosen yet
    if (!previewImage && generatedImages.length) setPreviewImage(generatedImages[0].url);
    if (!previewTitle) setPreviewTitle(titleText || 'This changed everything (I was shocked)');
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

  const goToMode = (m: ThumbInputMode) => {
    setMode(m);
    setNote(null);
    setSection('generate');
    setSidebarOpen(false);
    setTimeout(() => document.getElementById('thumb-tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  // From the clean landing: jump to the generate page and, if the box has text, start immediately
  const startFromHome = () => {
    const trimmed = promptText.trim();
    const ytId = trimmed ? extractYouTubeId(trimmed) : null;
    if (ytId) {
      // Someone pasted a YouTube link into the plain description box (easy
      // mistake — there's no separate box visible yet from the home page).
      // Treating that URL as literal prompt text would just describe "a
      // video at this URL" instead of actually using it — route to the real
      // YouTube flow instead, pre-filled, so they land ready to Generate
      // there rather than getting a broken result from the wrong mode.
      setYoutubeUrl(trimmed);
      setPromptText('');
      setMode('youtube');
      setNote(null);
      setSection('generate');
      setSidebarOpen(false);
      // Same login/credits gate as the plain-prompt path below — only queue
      // the auto-generate if it could actually proceed, so a logged-out or
      // zero-credit visitor lands on the YouTube tab ready to go instead of
      // silently no-oping (or getting shunted to a login/pricing prompt they
      // didn't ask for by clicking what looked like a "generate" button).
      if (!(configured && !user) && !(configured && user && !creditsLoading && totalCredits <= 0)) {
        setAutoGenerateOnEntry(true);
      }
      setTimeout(() => document.getElementById('thumb-tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      return;
    }
    if (!trimmed) {
      // Nothing typed — land on the primary YouTube-link flow rather than
      // defaulting into Prompt mode, which only makes sense once there's
      // actual description text to act on.
      setMode('youtube');
      setNote(null);
      setSection('generate');
      setSidebarOpen(false);
      setTimeout(() => document.getElementById('thumb-tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      return;
    }
    setMode('prompt');
    setNote(null);
    setSection('generate');
    if (configured && !user) { requireLogin('Log in to generate your thumbnail.'); return; }
    if (configured && user && !creditsLoading && totalCredits <= 0) { goPricing(); return; }
    const prompt = `${trimmed}. ${textDirective(titleText)} ${BASE_THUMB}`;
    onGenerate(prompt, [...uploads], { count: genCount, modelType: QUALITY_MODEL[genModel], resolution: QUALITY_RESOLUTION[genModel] });
    scrollToResults();
  };

  const fileRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // ── Infinite scroll: render a small window of results, grow on scroll ──────
  // Avoids painting a whole history at once; combined with lazy <img> loading
  // it keeps memory + network light no matter how many thumbnails exist.
  const PAGE = 8;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  // New results prepend to the top — make sure they're shown without a scroll.
  useEffect(() => { setVisibleCount(c => Math.max(c, PAGE)); }, [generatedImages.length]);

  // A callback ref (not useRef + a useEffect keyed on visibleCount/length) —
  // the sentinel can first mount long after those values last changed (e.g.
  // the whole gallery history is already restored before the user ever opens
  // this tab), which left a dependency-array effect with nothing to re-run and
  // the observer never created, so nothing past the first page ever loaded.
  // A callback ref fires exactly when the DOM node itself mounts/unmounts, so
  // it can't miss that.
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisibleCount(c => c + PAGE);
    }, { rootMargin: '400px' });
    io.observe(el);
    observerRef.current = io;
  }, []);

  const readFiles = (files: File[]) => {
    files.filter(f => f.type.startsWith('image/')).forEach(file => {
      const r = new FileReader();
      r.onload = e => {
        if (e.target?.result) setUploads(prev => [...prev, e.target!.result as string].slice(0, 4));
      };
      r.readAsDataURL(file);
    });
  };

  // Ask for login before opening the file picker (or accepting a drop) when
  // signed out, instead of letting someone upload photos they can't use yet.
  const triggerUpload = () => {
    if (configured && !user) { requireLogin('Log in to upload photos.'); return; }
    fileRef.current?.click();
  };
  const dropFiles = (files: File[]) => {
    if (configured && !user) { requireLogin('Log in to upload photos.'); return; }
    readFiles(files);
  };

  // Saved faces ("personas") — reuse a face across generations without
  // re-uploading it every time. personaRefreshKey bumps to tell every open
  // PersonaPicker instance to re-fetch after a new save.
  const [personaRefreshKey, setPersonaRefreshKey] = useState(0);
  const pickPersona = (dataUrl: string) => setUploads(prev => [...prev, dataUrl].slice(0, 4));
  const saveAsPersona = async (dataUrl: string) => {
    if (!user) { requireLogin('Log in to save faces.'); return; }
    try {
      await savePersona(dataUrl);
      setPersonaRefreshKey(k => k + 1);
      setNoteText('Face saved for reuse.', 'success');
    } catch (e: any) {
      setNoteText(e?.message || 'Could not save that face.');
    }
  };

  // "Change face" — fix a wrong/unwanted face on an already-generated
  // thumbnail (e.g. one pulled in from a reference-style image) without
  // redoing the whole generation. Modal builds an edit prompt + sources;
  // this just queues it like any other generation. changeFaceTarget/
  // setChangeFaceTarget are now props (owned by App) so the Studio's own
  // lightbox there can trigger this too, not just the per-card button below.
  const applyChangeFace = (prompt: string, sources: string[]) => {
    // Same eligibility gate as the main Generate button — this bypasses that
    // button entirely, so it needs its own login/credit check before queuing.
    if (configured && !user) { requireLogin('Log in to change faces.'); return; }
    if (configured && user && !creditsLoading && totalCredits <= 0) { goPricing(); return; }
    onGenerate(prompt, sources, { count: 1, modelType: QUALITY_MODEL[genModel], resolution: QUALITY_RESOLUTION[genModel] });
    setChangeFaceTarget(null);
    scrollToResults();
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) readFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const canGenerate = (() => {
    if (busy) return false;
    if (mode === 'youtube') return extractYouTubeId(youtubeUrl) !== null;
    if (mode === 'templates') return !!selectedRef && (titleText.trim().length > 0 || uploads.length > 0);
    if (mode === 'prompt') return promptText.trim().length > 0;
    if (mode === 'reference') return uploads.length > 0 || titleText.trim().length > 0;
    if (mode === 'sketch') return sketchData !== null;
    return false;
  })();

  const scrollToResults = () =>
    setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    // Gate behind auth + credits once Supabase is configured (dev without keys stays open).
    if (configured) {
      if (!user) { requireLogin('Log in to generate your thumbnail.'); return; }
      if (!creditsLoading && totalCredits <= 0) { goPricing(); return; }
    }
    setNote(null);
    let prompt = '';
    let sources: string[] = [...uploads];
    // Shared across every concept-driven mode (YouTube/Prompt/Styles/Sketch):
    // hand the AI full creative freedom on the VISUAL staging instead of a
    // prescriptive checklist — still photorealistic, just not a plain
    // literal shot. Doesn't mandate any specific text/callout treatment
    // (text still follows the normal headline rules elsewhere). Off by
    // default since it's less predictable than the standard look.
    const creativeDirective = creativeMode
      ? "You have full creative freedom here — imagine and depict the topic in whatever bold, unexpected, visually striking way feels most fitting, not a plain literal shot. "
      : '';

    if (mode === 'youtube') {
      const id = extractYouTubeId(youtubeUrl);
      if (!id) return;
      const wantCount = Math.max(1, Math.min(4, genCount));

      // Thumbnail + title + transcript are fetched once per link and cached
      // (see ytFetchCache above). The concept — TWO distinct AI thumbnail
      // ideas + a headline — is designed FRESH on every Generate click: it's
      // a free (0-credit) operation, so there's no cost reason to reuse a
      // stale concept, and regenerating gives different angles each time.
      setBusy(true);
      setNoteText('Analysing the video — thumbnail, title and transcript…', 'info');
      const fetched = ytFetchCache.current[id] ?? await Promise.all([
        fetchYouTubeThumb(id),
        fetchYouTubeTitle(id),
        fetchTranscript(id),
      ]);
      ytFetchCache.current[id] = fetched;
      const [thumb, title, segments] = fetched;
      // Best-effort — if the text model is unavailable we still generate from
      // the title and the original thumbnail. The concept step is free; the
      // credit check below is for the images that follow it.
      let conceptA = '', conceptB = '', headlineA = '', headlineB = '';
      const transcriptText = segments ? sampleTranscript(segments, 3500) : '';
      if (title || transcriptText) {
        // Skip while the profile is still loading — totalCredits reads 0
        // until it resolves, which would otherwise redirect a user with
        // plenty of credits to pricing just because they clicked early.
        // Check for the FULL batch, not just one image — each of the
        // wantCount images queued below is its own 3-credit charge, so
        // under-checking here would let a user with (say) 4 credits queue
        // 4 variations, watch the first one succeed, and then get 3
        // "Generation failed" cards instead of a clear message up front.
        const perThumbCost = YOUTUBE_IMAGE_COST + (genModel === '4k' ? RES_SURCHARGE_4K : 0);
        if (configured && !creditsLoading && totalCredits < perThumbCost * wantCount) {
          setBusy(false);
          setNoteText(`This costs ${perThumbCost} credits per thumbnail — ${perThumbCost * wantCount} credits for ${wantCount}. Please top up your plan.`);
          goPricing();
          return;
        }
        // Accurate mode's whole premise is grounding in the transcript — with
        // none available it can't honour that, so it only applies when there's
        // actually transcript text to ground in (silently falling back to the
        // normal title-driven concept style otherwise, same as the toggle
        // being off, rather than sending a self-contradicting "ground this in
        // the transcript" instruction alongside "(no transcript available)").
        const accurateApplies = accurateMode && !!transcriptText;
        const userDirection = promptText.trim().slice(0, 400);
        if (accurateMode && !transcriptText) {
          setNoteText("No transcript available for this video — designing from the title instead.", 'info');
        } else {
          setNoteText('Designing two fresh thumbnail concepts…', 'info');
        }
        try {
          const raw = await generateText(
            `You are a world-class YouTube thumbnail art director. Analyse the video below and design TWO clearly DIFFERENT, click-worthy thumbnail concepts for it, each with its OWN short on-thumbnail headline that matches ITS specific scene.\n\n` +
            `Rules:\n` +
            `- Both concepts must be REAL, photorealistic, real-footage style scenes that literally depict what THIS video is about (its actual topic, people, place or event) — no abstract art, no invented unrelated imagery.\n` +
            `- Make the two concepts genuinely distinct: different composition, subject framing, angle, setting or emotion — not two versions of the same shot.\n` +
            `- Each concept: ONE vivid sentence covering the main subject + their expression/emotion, the key real-world scene/elements, and the mood, lighting and colour palette. Concrete and purely visual.\n` +
            (accurateApplies ? `- Accuracy over invention: first identify the video's distinct main topics/segments from the transcript, then base CONCEPT_A and CONCEPT_B on two DIFFERENT real topics it actually covers — not two takes on the same one, and not a topic that's only briefly mentioned in passing. Name the real people, places, objects or events the transcript actually names rather than generic stand-ins. Keep each concept short and literal: a faithful depiction of that specific topic, grounded strictly in what the transcript says, never a generic or imagined scene.\n` : '') +
            // Accurate mode wins when both toggles are on: "ground this strictly
            // in the transcript, never imagine" and "you have full creative
            // freedom, don't be literal" are direct opposites, and sending both
            // left the model to pick one at random — the reason accurate mode
            // seemed to do nothing for anyone who also had creative mode on.
            (creativeMode && !accurateApplies ? `- You have full creative freedom for these concepts — imagine the video in whatever bold, unexpected, visually striking way feels right, not a plain literal depiction. Still grounded in what the video is actually about.\n` : '') +
            // The user's own direction has to shape the CONCEPT, not get bolted
            // onto the image prompt afterwards — a concept designed without it
            // and an instruction demanding it pull the image model in two
            // directions, which is exactly when results came out mangled.
            (userDirection ? `- The user gave direction for this thumbnail. Treat it as a REQUIREMENT both concepts must satisfy, not a suggestion: "${userDirection}". If it names specific words to put on the thumbnail, use exactly those words as that concept's HEADLINE (verbatim, not reworded or expanded) and do not restate the instruction inside the concept sentence. If it describes the subject, scene, colours or mood instead, build both concepts around it and let the headline follow the video's hook as usual.\n` : '') +
            `- Decide for each concept whether on-image text actually helps: most great thumbnails work purely through the visual — only give a concept a headline if it genuinely adds punch beyond what the image already communicates. If a headline helps, it must be a punchy 2-4 word hook, NEVER the title restated or any full sentence. If a concept doesn't need one, reply its HEADLINE as NONE — do not force one just to fill the field.\n\n` +
            `Reply in EXACTLY this format, nothing else:\n` +
            `CONCEPT_A: <sentence>\nHEADLINE_A: <2-4 words, or NONE>\nCONCEPT_B: <sentence>\nHEADLINE_B: <2-4 words, or NONE>\n\n` +
            `TITLE: ${title || '(unknown)'}\n\nTRANSCRIPT (excerpt):\n${transcriptText || '(no transcript available)'}`,
            'concept'
          );
          const grab = (label: string) => {
            const m = new RegExp(`${label}\\s*:\\s*(.+)`, 'i').exec(raw || '');
            return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
          };
          conceptA = grab('CONCEPT_A').slice(0, 400);
          conceptB = grab('CONCEPT_B').slice(0, 400);
          headlineA = grab('HEADLINE_A').replace(/[."']+$/g, '').slice(0, 40);
          headlineB = grab('HEADLINE_B').replace(/[."']+$/g, '').slice(0, 40);
          if (/^none$/i.test(headlineA.trim())) headlineA = '';
          if (/^none$/i.test(headlineB.trim())) headlineB = '';
          // If the model ignored the format, treat the whole reply as one concept.
          if (!conceptA && !conceptB && raw?.trim()) conceptA = raw.trim().slice(0, 400);
        } catch (_e) {
          /* concept generation is free and best-effort — on failure it just stays
             empty and we fall back to the title/thumbnail further below */
        }
      }
      setBusy(false);
      setNote(null);

      if (!thumb && !title && !conceptA && !conceptB && !promptText.trim()) {
        setNoteText('Could not read that video (private/unavailable). Open Advanced and describe what you want for best results.');
        return;
      }

      // Optional "Advanced" inputs: extra direction + a person's photo.
      const dir = promptText.trim() ? `Extra direction: ${promptText.trim().slice(0, 400)}. ` : '';
      const hasFace = uploads.length > 0;
      // No uploaded photo? Fall back to the REAL person from the video's own
      // current thumbnail (already fetched as a base64 data URL — no extra
      // fetch needed) so the result features the actual host, not an invented
      // face. We take ONLY their identity from it — never its layout, quality
      // or text — the new design is still grounded in our own style library.
      const thumbFaceRef = !hasFace && thumb ? thumb : null;
      const faceDir = hasFace
        ? 'Feature the person from the uploaded photo as the main subject and preserve their likeness. '
        : thumbFaceRef
          ? "An additional reference photo (the video's own current thumbnail) is provided — if a real person/face appears in it, feature THAT exact person as the main subject and preserve their true likeness accurately and photorealistically; take ONLY their identity from it, ignoring its layout, background, text and quality. If no clear person appears in it, invent the subject from the concept instead. "
          : '';
      const titleLine = title ? `The video is titled "${title}". ` : '';
      // The video's own topic only. Advanced's direction used to be mixed in
      // here too, so an instruction like "make it dramatic" was matched against
      // the topic-hint patterns as if it were the video's subject and pulled in
      // an unrelated hint — one of three places the same sentence was being
      // injected in three different roles (topic, headline text, extra
      // direction), which is a large part of why custom input produced mangled
      // thumbnails. It now shapes the concept instead (see the concept prompt).
      const topicSeed = title || '';
      // Premium + instantly-legible direction so the result matches the reference-style thumbnails.
      const ytPremium = "The thumbnail should communicate the video's topic at a glance — a viewer should quickly grasp what it's about — using a clear, expressive focal subject and topic-relevant visual cues. Make it look genuinely premium and high-end, on par with the best top-creator thumbnails: bold, polished, richly detailed and click-worthy. ";
      const realFootage = "Render it as authentic real-footage-style photography — like a genuine photo/still captured on a professional camera for THIS exact topic, with real depth of field and natural lighting; not an illustration, cartoon or generic stock art. ";

      // Concept-only prompt — the last resort if NOT A SINGLE style image is
      // readable. Builds from the video's topic/concept, NEVER recreating the
      // video's own (often low-res) thumbnail's layout — faceDir above still
      // carries over the real person from it, if any, via thumbFaceRef. Takes
      // its OWN headline (paired with this specific concept), not one shared
      // across every variant.
      const buildConceptOnly = (concept: string, conceptHeadline: string) => {
        const conceptLine = concept ? `Base the thumbnail on this concept drawn from the video's actual content: ${concept} ` : '';
        const textSeed = conceptHeadline; // headline comes from the concept step, not the raw direction
        return `Create a viral, click-worthy YouTube thumbnail for this video. ${titleLine}${conceptLine}${ytPremium}${realFootage}${creativeDirective}${faceDir}${dir}${topicDirective(topicSeed)}${textDirective(textSeed)} ${BASE_THUMB}`;
      };

      const finalize = (p: string) => (format === 'short' ? p.replace(BASE_THUMB, BASE_SHORT) : p);
      const genOpts = { count: 1, modelType: QUALITY_MODEL[genModel], resolution: QUALITY_RESOLUTION[genModel], aspect: format === 'short' ? '9:16' : '16:9', sourceMode: 'youtube' as const };
      // wantCount (Variations picker, 1-4) computed above — each slot still
      // gets its own onGenerate() call (one real image per call), just like
      // every other mode's variation handling in handleStudioGenerate.

      // ── Ground each variant in one of OUR OWN curated styles — NEVER the
      // video's own (often low-res) thumbnail. Vector search finds the styles
      // that best fit THIS video's topic; if that's unavailable (not signed in,
      // no embedding credits) fall back to the loaded style pool — still never
      // the source thumbnail. A little per-run randomness among the top matches
      // keeps repeat generations on the same link visually fresh.
      setBusy(true);
      // A manually picked style (Advanced → "Pick a style") skips auto-match
      // entirely — every variation slot uses that one style. No `meta` for
      // it (it's a plain pool URL, not a vector-search hit), which the prompt
      // builder below already handles via its `metaKnown` fallback.
      let pool: { url: string; meta?: any }[];
      // Index 0 = styles matched for concept A, 1 = for concept B. Null for
      // every path that has no per-concept notion (manual pick, unfiltered
      // fallbacks), in which case slots just cycle the flat pool as before.
      let poolByConcept: { url: string; meta?: any }[][] | null = null;
      if (selectedYtStyle) {
        pool = [{ url: selectedYtStyle }];
      } else {
        setNoteText('Analyzing your video…', 'info');
        // Match each concept SEPARATELY. Blending both into one query (as this
        // used to) embeds the average of two deliberately different scenes —
        // a vector sitting between "lone hiker on a cliff at dawn" and "crowded
        // trading floor" matches neither, so both variations got styles picked
        // for a scene that doesn't exist. Two searches (free, run in parallel)
        // give each concept the styles that actually fit it; results are
        // interleaved so the shuffled candidate list stays fair to both.
        const queries = [conceptA, conceptB].filter(c => c && c.trim());
        const perConcept = await Promise.all(
          (queries.length ? queries : [title].filter(Boolean)).map(q =>
            matchStyles([title, q].filter(v => v && v.trim()).join('. ').slice(0, 4000), 6, onlyMyStyles)
          )
        );
        const seen = new Set<string>();
        const matched: { url: string; meta?: any }[] = [];
        for (let rank = 0; rank < 6; rank++) {
          for (const list of perConcept) {
            const hit = list[rank];
            if (hit && !seen.has(hit.url)) { seen.add(hit.url); matched.push({ url: hit.url, meta: hit.meta }); }
          }
        }
        if (matched.length) {
          pool = matched;
          poolByConcept = perConcept.map(list => list.map(m => ({ url: m.url, meta: m.meta })));
        } else if (onlyMyStyles) {
          // No good semantic match among the user's own styles — still stay
          // within their own pool (never fall back to the global one, that
          // would defeat the toggle) by just using it unfiltered. Only error
          // out if they genuinely have no custom styles at all yet.
          const mine = await fetchMyStyles();
          if (!mine.length) {
            setBusy(false);
            setNoteText("You don't have any custom styles yet — upload one from your Account page, or turn off \"Only my styles\".");
            return;
          }
          pool = mine.map(s => ({ url: s.url }));
        } else {
          pool = (await fetchStyleImages()).map(u => ({ url: u }));
        }
      }

      if (pool.length) {
        const shuffled = <T,>(arr: T[]): T[] => {
          const a = [...arr];
          for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
          return a;
        };
        const candidates = shuffled(pool.slice(0, Math.min(pool.length, Math.max(5, wantCount + 2))));
        // Slots alternate concept A / B (see conceptPair below), so a slot draws
        // from the styles matched for ITS concept — otherwise concept A's shot
        // could be built on a style picked for concept B, which is how a
        // perfectly good match still produced an off-looking thumbnail. Falls
        // back to the flat candidate list whenever there's no per-concept split.
        const perSlotPools = poolByConcept?.some(l => l.length)
          ? poolByConcept.map(l => shuffled(l.slice(0, Math.max(3, Math.ceil(wantCount / 2) + 2))))
          : null;
        const chosen = Array.from({ length: wantCount }, (_, i) => {
          const own = perSlotPools?.[i % 2];
          if (own && own.length) return own[Math.floor(i / 2) % own.length];
          return candidates[i % candidates.length];
        });
        const conceptPair = [conceptA || conceptB, conceptB || conceptA];
        const concepts = Array.from({ length: wantCount }, (_, i) => conceptPair[i % 2]);
        // Each concept keeps ITS OWN paired headline (not one shared across
        // every variant) — falls back to the other slot's headline if one
        // side came back blank, same as conceptPair above.
        const headlinePair = [headlineA || headlineB, headlineB || headlineA];
        const headlines = Array.from({ length: wantCount }, (_, i) => headlinePair[i % 2]);

        // Second concept pass: NOW that we know which curated style each slot
        // actually landed on, ask the AI to elevate that slot's concept using
        // the style's own proven composition/mood as inspiration — WITHOUT
        // copying its specific subject/scene (that belongs to a different,
        // unrelated thumbnail; the image prompt below already forbids that
        // separately). This is a refinement of what's already grounded in the
        // video's content, not a replacement — "inspired by, better", not "same as".
        // Free (0-credit) op, same as the first concept call. Deduped by
        // (concept, style) pair and run in parallel so it doesn't multiply
        // latency by wantCount when several slots share the same combo.
        setNoteText('Refining concepts to match your best-fit styles…', 'info');
        const pairKey = (c: string, url: string) => `${c} ${url}`;
        const uniquePairs = new Map<string, { concept: string; style: typeof chosen[number] }>();
        for (let i = 0; i < wantCount; i++) {
          const c = concepts[i];
          const s = chosen[i];
          if (c && s) uniquePairs.set(pairKey(c, s.url), { concept: c, style: s });
        }
        const refinedByKey = new Map<string, string>();
        await Promise.all(Array.from(uniquePairs.entries()).map(async ([key, { concept, style }]) => {
          const meta = style.meta || {};
          const styleHint = meta.summary ? `REFERENCE STYLE (from our curated library, for energy/composition only): ${meta.summary}\n` : '';
          try {
            const raw = await generateText(
              `You are a world-class YouTube thumbnail art director. Elevate the DRAFT concept below by drawing inspiration from a proven, high-performing reference style — its composition, framing, mood, lighting and energy — WITHOUT copying its specific subject, people, props or exact scene (that reference belongs to a completely different, unrelated thumbnail).\n\n` +
              `Rules:\n` +
              `- Stay grounded in the DRAFT concept's actual subject/topic — never change what the thumbnail is about.\n` +
              `- Improve it: sharper focal point, stronger composition, better use of light/colour/mood — inspired BY the reference's energy, not a copy of its content. It must end up BETTER than the draft, never identical to the reference.\n` +
              `- Reply with ONLY one improved vivid sentence, concrete and purely visual — no preamble, no mention of "style", "reference" or "draft".\n\n` +
              `DRAFT CONCEPT: ${concept}\n${styleHint}`,
              'concept'
            );
            const improved = raw?.trim().replace(/^["']|["']$/g, '').slice(0, 400);
            if (improved) refinedByKey.set(key, improved);
          } catch (_e) {
            /* refine is best-effort — falls back to the draft concept below */
          }
        }));
        for (let i = 0; i < wantCount; i++) {
          const c = concepts[i];
          const s = chosen[i];
          if (!c || !s) continue;
          const refined = refinedByKey.get(pairKey(c, s.url));
          if (refined) concepts[i] = refined;
        }

        setNoteText('Designing your thumbnails…', 'info');
        let launched = 0;
        for (let i = 0; i < wantCount; i++) {
          const style = chosen[i];
          const meta = style.meta || {};
          const concept = concepts[i] || '';
          // The concept step now owns the headline (it was given the user's
          // direction and told to put any explicitly-requested words straight
          // into HEADLINE). Seeding it with the raw Advanced text instead — as
          // this used to — meant "put an office in the background" came back
          // distilled into an on-image headline reading "OFFICE BACKGROUND".
          const textSeed = headlines[i] || '';
          const styleB64 = await urlToBase64(style.url);
          if (!styleB64) continue; // skip an unreadable style rather than recreating the video's thumbnail

          // Any face reference beyond the style image itself — uploaded photo takes
          // priority; otherwise fall back to the video's own current thumbnail so
          // the real host's face carries over instead of an invented one.
          const faceRefImages = hasFace ? uploads : (thumbFaceRef ? [thumbFaceRef] : []);
          const styleHint = meta.summary ? `Reference style vibe: ${meta.summary}. ` : '';
          // PERSON: uploaded photo → swap that person in; else the video's own
          // thumbnail's real person, if it has one; else build from the concept
          // (never reuse the style image's own person). Stated as a hard
          // negative constraint, not just a positive instruction — image models
          // weigh the pixels of a reference image heavily, so "use X" alone is
          // often not enough to stop it defaulting to the face it can see.
          const faceStyle = hasFace
            ? "For the main person, use the person from the uploaded photo (the SECOND image) — swap in their face and likeness accurately and photorealistically, matching this style's pose, scale and lighting. Do NOT use the FIRST image's person — that is a completely different, unrelated person from someone else's video. "
            : thumbFaceRef
              ? "The SECOND image is the video's own current thumbnail — if a real person/face appears in it, use THAT exact person as the main subject: preserve their true face, identity and likeness accurately and photorealistically, matching this style's pose, scale and lighting. Take ONLY their identity from it — ignore its layout, background, text and quality entirely. If no clear person appears in it, build the subject from the video's concept instead. Either way, do NOT use the FIRST image's person — that is a completely different, unrelated person from someone else's video. "
              : "Build the main subject from the video's concept. Do NOT reuse the FIRST image's specific person or face under any circumstances — that is a real, different, unrelated person from someone else's video, not a placeholder to fall back on. Invent a new subject that matches the concept instead. ";
          // TEXT: driven by whether THIS style itself uses on-image text.
          const styleTexts = Array.isArray(meta.elements?.texts) ? meta.elements.texts : [];
          const metaKnown = !!(meta.summary || meta.text_density || meta.elements);
          const styleUsesText = styleTexts.length > 0
            || meta.text_density === 'high' || meta.text_density === 'low'
            || (!metaKnown && !!textSeed);
          // Naming the FIRST image's exact original words (when we know them from
          // indexing) gives the model something concrete to NOT reproduce — a
          // generic "don't copy the text" is easy for it to ignore when the exact
          // words are sitting right there in the pixels it's looking at.
          const originalWords = styleTexts.map((t: any) => t?.current).filter(Boolean).join('", "');
          const noOldWords = originalWords ? `Specifically, do NOT render the FIRST image's own original words ("${originalWords}") anywhere — those belong to a different video. ` : '';
          const textStyle = styleUsesText
            ? (textSeed
                ? `This style shows headline text — REPLACE it with a short punchy headline for THIS video, derived from its title/topic (distil to 2-4 uppercase words, not a full sentence) based on "${textSeed}". Keep the SAME position, size and treatment as the style. Render ONLY this one new headline, correctly spelled — no other words, duplicates or gibberish. ${noOldWords}`
                : `This style shows headline text — add ONE short punchy 2-4 word uppercase headline capturing THIS video's hook, in the same position/treatment as the style; correctly spelled, no other words or gibberish. ${noOldWords}`)
            : `This style uses NO on-image text — represent the topic through VISUALS ONLY (subject, scene, props, symbols). Do NOT add any text, letters, words or numbers anywhere. `;

          const p = `Use the FIRST image ONLY as a visual STYLE template — borrow just the elements that serve THIS video: its overall composition, framing, lighting, colour grade, mood and (only if text is used) its text placement. CRITICAL: the FIRST image is from a completely different, unrelated video — its specific person/face, its props, and its exact on-image wording all belong to THAT video, not this one. Do NOT copy any of them — take ONLY the visual style and create an ORIGINAL thumbnail for THIS video in that same look. ${titleLine}${concept ? `Concept drawn from the video's actual content: ${concept} ` : ''}${styleHint}${faceStyle}${textStyle}${ytPremium}${realFootage}${creativeDirective}${dir}${topicDirective(topicSeed)} ${BASE_THUMB}`;
          onGenerate(finalize(p), [styleB64, ...faceRefImages], genOpts);
          launched++;
        }
        if (launched) { setBusy(false); setNote(null); scrollToResults(); return; }
      }

      // Last resort: not a single style image was readable → build from the
      // video's concept alone, still never copying the video's own thumbnail's
      // layout — only (via faceDir/thumbFaceRef above) the real person in it, if
      // any. Still honours the Variations picker, cycling A/B when both concepts exist.
      const fallbackConcepts = (conceptA && conceptB) ? [conceptA, conceptB] : [conceptA || conceptB];
      const fallbackHeadlines = (conceptA && conceptB) ? [headlineA, headlineB] : [headlineA || headlineB];
      const variants = Array.from({ length: wantCount }, (_, i) => buildConceptOnly(fallbackConcepts[i % fallbackConcepts.length], fallbackHeadlines[i % fallbackHeadlines.length] || ''));
      const fallbackFaceRefs = hasFace ? uploads : (thumbFaceRef ? [thumbFaceRef] : []);
      variants.forEach(v => onGenerate(finalize(v), [...fallbackFaceRefs], genOpts));
      setBusy(false);
      setNote(null);
      scrollToResults();
      return;
    } else if (mode === 'templates') {
      const topic = titleText.trim();
      const hasFace = uploads.length > 0;
      if (selectedRef) {
        // Same structure as YouTube/Prompt mode: design two distinct AI
        // concepts + a headline from the typed topic first (free, best-
        // effort), then use the picked reference ONLY as a visual STYLE
        // template for each variation slot — never an exact reproduction of
        // it — so the result is a new thumbnail for the user's own topic in
        // that style, the same way YouTube/Prompt mode use their matched
        // style images. Handles its own onGenerate calls/return, same reason
        // as those modes.
        const wantCount = Math.max(1, Math.min(4, genCount));
        const finalize = (p: string) => (format === 'short' ? p.replace(BASE_THUMB, BASE_SHORT) : p);
        const genOpts = { count: 1, modelType: QUALITY_MODEL[genModel], resolution: QUALITY_RESOLUTION[genModel], aspect: format === 'short' ? '9:16' : '16:9' };

        setBusy(true);
        const refB64 = await urlToBase64(selectedRef);
        if (!refB64) {
          setBusy(false);
          setNoteText('Could not load that style image. Please try again.');
          return;
        }

        setNoteText(`Designing ${wantCount} fresh thumbnail concept${wantCount > 1 ? 's' : ''}…`, 'info');
        // One DISTINCT concept per requested variation (not just two cycled
        // to fill however many were asked for) — picking "4" should mean 4
        // genuinely different angles, same as picking "1" means one.
        let concepts: string[] = [];
        let headline = '';
        try {
          const labels = Array.from({ length: wantCount }, (_, i) => `CONCEPT_${i + 1}`);
          const raw = await generateText(
            `You are a world-class YouTube thumbnail art director. Analyse the topic below and design ${wantCount} clearly DIFFERENT, click-worthy thumbnail concept${wantCount > 1 ? 's' : ''} for it, plus one short on-thumbnail headline.\n\n` +
            `Rules:\n` +
            `- Every concept must be REAL, photorealistic, real-footage style scenes that literally depict what this thumbnail is about — no abstract art, no invented unrelated imagery.\n` +
            (wantCount > 1 ? `- Make all ${wantCount} concepts genuinely distinct from EACH OTHER: different composition, subject framing, angle, setting or emotion — no two should be variations of the same shot.\n` : '') +
            `- Each concept: ONE vivid sentence covering the main subject + their expression/emotion, the key real-world scene/elements, and the mood, lighting and colour palette. Concrete and purely visual.\n` +
            (creativeMode ? `- You have full creative freedom for these concepts — imagine the topic in whatever bold, unexpected, visually striking way feels right, not a plain literal depiction.\n` : '') +
            `- Decide for yourself whether on-image text actually helps: most great thumbnails work purely through the visual — only add a headline if it genuinely adds punch beyond what the image already communicates. If a headline helps, it must be a punchy 2-4 word hook, NEVER the topic restated or any full sentence. If no headline is genuinely needed, reply HEADLINE: NONE — do not force one just to fill the field.\n\n` +
            `Reply in EXACTLY this format, nothing else:\n` +
            `${labels.map(l => `${l}: <sentence>`).join('\n')}\nHEADLINE: <2-4 words, or NONE>\n\n` +
            `TOPIC: ${topic || "match the reference image's style and mood"}`,
            'concept'
          );
          const grab = (label: string) => {
            const m = new RegExp(`${label}\\s*:\\s*(.+)`, 'i').exec(raw || '');
            return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
          };
          concepts = labels.map(l => grab(l).slice(0, 400)).filter(Boolean);
          headline = grab('HEADLINE').replace(/[."']+$/g, '').slice(0, 40);
          if (/^none$/i.test(headline.trim())) headline = '';
          if (!concepts.length && raw?.trim()) concepts = [raw.trim().slice(0, 400)];
        } catch (_e) {
          /* concept generation is free and best-effort — falls back to the typed topic below */
        }
        // NEVER fall back to the raw typed topic here — that's an idea to
        // build a VISUAL from, not text meant to appear on the thumbnail. If
        // the AI didn't produce a genuine short headline, textDirective('')
        // correctly keeps the image clean instead of forcing the topic text
        // itself onto the image.
        const textSeed = headline;

        setNoteText('Designing your thumbnails…', 'info');
        // If the model returned fewer usable concepts than slots (bad
        // formatting, one blank line, etc.), cycle what we did get rather
        // than leaving later slots with nothing.
        const usableConcepts = concepts.length ? concepts : [''];
        const faceStyle = hasFace
          ? "For the main person, use the person from the uploaded photo — swap in their face and likeness accurately and photorealistically, matching this style's pose, scale and lighting. Do NOT use the reference image's own person — that belongs to a different, unrelated thumbnail. "
          : "Build the main subject from the concept below. Do NOT reuse the reference image's own specific person or face — that belongs to a different, unrelated thumbnail; invent a new subject that matches the concept instead. ";

        let launched = 0;
        for (let i = 0; i < wantCount; i++) {
          const concept = usableConcepts[i % usableConcepts.length] || topic;
          const p = `Use the FIRST image ONLY as a visual STYLE template — borrow just its overall composition, framing, lighting, colour grade, mood and (only if text is used) its text placement, for a brand-new thumbnail. CRITICAL: the FIRST image is from a completely different, unrelated thumbnail — its specific person/face, its props, and its exact on-image wording all belong to that one, not this. Do NOT copy any of them — take ONLY the visual style. ${concept ? `Concept: ${concept} ` : ''}${faceStyle}${textDirective(textSeed)}${creativeDirective}${topicDirective(topic)} ${BASE_THUMB}`;
          onGenerate(finalize(p), [refB64, ...uploads], genOpts);
          launched++;
        }
        setBusy(false);
        if (launched) { setNote(null); scrollToResults(); }
        return;
      } else {
        const tpl = THUMBNAIL_TEMPLATES.find(t => t.id === selectedTemplate)!;
        // If this template has a real preview image, send it as a style reference so the
        // result actually matches the template instead of looking random.
        const tplPreview = TEMPLATE_PREVIEWS[tpl.id] || SHOWCASE_TEMPLATE_PREVIEWS[tpl.id];
        if (tplPreview) {
          setBusy(true);
          const tplBase64 = await urlToBase64(tplPreview);
          setBusy(false);
          if (tplBase64) sources = [tplBase64, ...sources];
        }
        const usingTplRef = tplPreview && sources.length > (hasFace ? 1 : 0);
        // Templates get extra care: match the template's look AND adapt it to the topic.
        prompt = `${tpl.style} ${usingTplRef ? 'Use the first reference image as the exact style, layout, composition and color template — closely match its framing, lighting and color grade while creating an original thumbnail for this topic (do not copy its subject verbatim). ' : ''}The video is about "${topic}". ${topicDirective(topic)}${hasFace ? 'Feature the person/photo from the uploaded reference as the main subject and preserve their likeness, blending them naturally into the template style. ' : ''}${textDirective(titleText)} ${BASE_THUMB}`;
      }
    } else if (mode === 'prompt') {
      // Same structure as YouTube mode: design two distinct AI concepts + a
      // headline from the description first (free, best-effort — same as
      // YouTube's transcript-based concept step), then auto-match a style
      // from our own curated library and blend a different concept/style
      // pairing into each variation slot, instead of generating from bare
      // text alone. Handles its own onGenerate calls/return, same as
      // YouTube mode, for the same reason.
      const hasFace = uploads.length > 0;
      const wantCount = Math.max(1, Math.min(4, genCount));
      const finalize = (p: string) => (format === 'short' ? p.replace(BASE_THUMB, BASE_SHORT) : p);
      const genOpts = { count: 1, modelType: QUALITY_MODEL[genModel], resolution: QUALITY_RESOLUTION[genModel], aspect: format === 'short' ? '9:16' : '16:9' };

      setBusy(true);
      setNoteText('Designing two fresh thumbnail concepts…', 'info');
      let conceptA = '', conceptB = '', headline = '';
      try {
        const raw = await generateText(
          `You are a world-class YouTube thumbnail art director. Analyse the description below and design TWO clearly DIFFERENT, click-worthy thumbnail concepts for it, plus one short on-thumbnail headline.\n\n` +
          `Rules:\n` +
          `- Both concepts must be REAL, photorealistic, real-footage style scenes that literally depict what this thumbnail is about — no abstract art, no invented unrelated imagery.\n` +
          `- Make the two concepts genuinely distinct: different composition, subject framing, angle, setting or emotion — not two versions of the same shot.\n` +
          `- Each concept: ONE vivid sentence covering the main subject + their expression/emotion, the key real-world scene/elements, and the mood, lighting and colour palette. Concrete and purely visual.\n` +
          (creativeMode ? `- You have full creative freedom for these concepts — imagine the topic in whatever bold, unexpected, visually striking way feels right, not a plain literal depiction.\n` : '') +
          `- Decide for yourself whether on-image text actually helps: most great thumbnails work purely through the visual — only add a headline if it genuinely adds punch beyond what the image already communicates. If a headline helps, it must be a punchy 2-4 word hook, NEVER the description restated or any full sentence. If no headline is genuinely needed, reply HEADLINE: NONE — do not force one just to fill the field.\n\n` +
          `Reply in EXACTLY this format, nothing else:\n` +
          `CONCEPT_A: <sentence>\nCONCEPT_B: <sentence>\nHEADLINE: <2-4 words, or NONE>\n\n` +
          `DESCRIPTION: ${promptText.trim()}`,
          'concept'
        );
        const grab = (label: string) => {
          const m = new RegExp(`${label}\\s*:\\s*(.+)`, 'i').exec(raw || '');
          return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
        };
        conceptA = grab('CONCEPT_A').slice(0, 400);
        conceptB = grab('CONCEPT_B').slice(0, 400);
        headline = grab('HEADLINE').replace(/[."']+$/g, '').slice(0, 40);
        if (/^none$/i.test(headline.trim())) headline = '';
        if (!conceptA && !conceptB && raw?.trim()) conceptA = raw.trim().slice(0, 400);
      } catch (_e) {
        /* concept generation is free and best-effort — falls back to the raw description below */
      }
      // NEVER fall back to the raw typed description here — that's an idea
      // to build a VISUAL from, not text meant to appear on the thumbnail.
      // If the AI didn't produce a genuine short headline, textDirective('')
      // correctly keeps the image clean instead of an image model rendering
      // the whole description verbatim as an on-image caption.
      const textSeed = headline;

      setNoteText('Designing your thumbnails…', 'info');
      const matchQuery = promptText.trim().slice(0, 4000);
      const matched = await matchStyles(matchQuery, 8, false);
      const pool: { url: string; meta?: any }[] = matched.length
        ? matched.map(m => ({ url: m.url, meta: m.meta }))
        : (await fetchStyleImages()).map(u => ({ url: u }));

      if (pool.length) {
        const candidates = pool.slice(0, Math.min(pool.length, Math.max(5, wantCount + 2)));
        for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
        const chosen = Array.from({ length: wantCount }, (_, i) => candidates[i % candidates.length]);
        const conceptPair = [conceptA || conceptB, conceptB || conceptA];
        const concepts = Array.from({ length: wantCount }, (_, i) => conceptPair[i % 2]);

        let launched = 0;
        for (let i = 0; i < wantCount; i++) {
          const style = chosen[i];
          const meta = style.meta || {};
          const concept = concepts[i] || '';
          const styleB64 = await urlToBase64(style.url);
          if (!styleB64) continue; // skip an unreadable style rather than falling back mid-loop

          const styleHint = meta.summary ? `Reference style vibe: ${meta.summary}. ` : '';
          const faceStyle = hasFace
            ? "For the main person, use the person from the uploaded photo — swap in their face and likeness accurately and photorealistically, matching this style's pose, scale and lighting. Do NOT use the reference image's own person — that belongs to a different, unrelated thumbnail. "
            : "Build the main subject from the concept below. Do NOT reuse the reference image's own specific person or face — that belongs to a different, unrelated thumbnail; invent a new subject that matches the concept instead. ";
          const styleTexts = Array.isArray(meta.elements?.texts) ? meta.elements.texts : [];
          const metaKnown = !!(meta.summary || meta.text_density || meta.elements);
          const styleUsesText = styleTexts.length > 0
            || meta.text_density === 'high' || meta.text_density === 'low'
            || (!metaKnown && !!textSeed);
          const originalWords = styleTexts.map((t: any) => t?.current).filter(Boolean).join('", "');
          const noOldWords = originalWords ? `Specifically, do NOT render the reference image's own original words ("${originalWords}") anywhere — those belong to a different thumbnail. ` : '';
          // The style ITSELF displays text in its design — leaving that box
          // blank would look broken, so it always needs SOME replacement
          // headline here even if the AI decided the concept didn't need one.
          const basedOn = textSeed || concept || promptText.trim();
          const textStyle = styleUsesText
            ? `This style shows headline text — REPLACE it with a short punchy headline for THIS thumbnail (2-4 uppercase words) based on: "${basedOn}". Keep the SAME position, size and treatment as the style. Render ONLY this one new headline, correctly spelled — no other words, duplicates or gibberish. ${noOldWords}`
            : `This style uses NO on-image text — represent the topic through VISUALS ONLY (subject, scene, props, symbols). Do NOT add any text, letters, words or numbers anywhere. `;

          const p = `Use the FIRST image ONLY as a visual STYLE template — borrow just its overall composition, framing, lighting, colour grade, mood and (only if text is used) its text placement, for a brand-new thumbnail. CRITICAL: the FIRST image is from a completely different, unrelated thumbnail — its specific person/face, its props, and its exact on-image wording all belong to that one, not this. Do NOT copy any of them — take ONLY the visual style. ${concept ? `Concept: ${concept} ` : `${promptText.trim()}. `}${styleHint}${faceStyle}${textStyle}${creativeDirective}${topicDirective(promptText)} ${BASE_THUMB}`;
          onGenerate(finalize(p), [styleB64, ...uploads], genOpts);
          launched++;
        }
        if (launched) { setBusy(false); setNote(null); scrollToResults(); return; }
      }

      // No usable style image at all (none readable, or the fetch failed) —
      // fall back to a plain concept/prompt-only generation.
      const faceDir = hasFace ? 'Feature the person(s) from the uploaded photo(s) as the main subject and preserve their face and likeness accurately. ' : '';
      const fallbackConcepts = (conceptA && conceptB) ? [conceptA, conceptB] : [conceptA || conceptB || promptText.trim()];
      const variants = Array.from({ length: wantCount }, (_, i) => finalize(`${fallbackConcepts[i % fallbackConcepts.length]}. ${faceDir}${creativeDirective}${topicDirective(promptText)} ${BASE_THUMB}`));
      variants.forEach(v => onGenerate(v, [...uploads], genOpts));
      setBusy(false);
      setNote(null);
      scrollToResults();
      return;
    } else if (mode === 'sketch') {
      if (!sketchData) return;
      // Same concept-first structure as YouTube/Prompt/Styles: the sketch
      // fixes the LAYOUT (that never changes — a concept can't move where
      // the sketch put things), but design one DISTINCT visual concept per
      // requested variation — different mood, lighting, colour palette or
      // scene detail — so multiple variations actually differ instead of
      // being carbon copies from one shared prompt. Handles its own
      // onGenerate calls/return, same reason as those modes.
      setBusy(true);
      const hasFace = uploads.length > 0;
      const topic = promptText.trim();
      const wantCount = Math.max(1, Math.min(4, genCount));
      const finalize = (p: string) => (format === 'short' ? p.replace(BASE_THUMB, BASE_SHORT) : p);
      const genOpts = { count: 1, modelType: QUALITY_MODEL[genModel], resolution: QUALITY_RESOLUTION[genModel], aspect: format === 'short' ? '9:16' : '16:9' };

      // Optional style reference — converted once, reused for every slot.
      // Kept clearly separate from the sketch/face sources so the "match
      // style only, not layout" instruction below has one unambiguous image
      // to point at.
      let styleB64: string | null = null;
      let styleDir = '';
      if (selectedSketchStyle) {
        styleB64 = await urlToBase64(selectedSketchStyle);
        if (styleB64) {
          styleDir = 'A final reference image is provided purely for visual STYLE — match its color grading, lighting mood and art treatment only. Do NOT copy its layout, composition or subjects; the hand-drawn sketch above always decides where everything goes. ';
        }
      }

      setNoteText(`Designing ${wantCount} fresh thumbnail concept${wantCount > 1 ? 's' : ''}…`, 'info');
      let concepts: string[] = [];
      try {
        const labels = Array.from({ length: wantCount }, (_, i) => `CONCEPT_${i + 1}`);
        const raw = await generateText(
          `You are a world-class YouTube thumbnail art director. A creator has sketched a rough thumbnail layout and described their idea below. Design ${wantCount} clearly DIFFERENT visual take${wantCount > 1 ? 's' : ''} on rendering that same sketch — same idea, same layout — but each with a distinct mood, lighting, colour palette or real-world scene detail.\n\n` +
          `Rules:\n` +
          `- Do NOT change the layout, composition or what's in each region — that's fixed by the sketch. Only vary the visual treatment: mood, lighting, colour grade, and concrete real-world scene details.\n` +
          (wantCount > 1 ? `- Make all ${wantCount} genuinely distinct from EACH OTHER — different mood/lighting/detail, not near-duplicates of the same look.\n` : '') +
          (creativeMode ? `- You have full creative freedom on mood, lighting and scene detail — imagine it in whatever bold, unexpected, visually striking way feels right, within the sketch's fixed layout.\n` : '') +
          `- Each concept: ONE vivid sentence, concrete and purely visual — no mention of "sketch" or "layout".\n\n` +
          `Reply in EXACTLY this format, nothing else:\n` +
          `${labels.map(l => `${l}: <sentence>`).join('\n')}\n\n` +
          `IDEA: ${topic || "match the sketch's own implied mood"}`,
          'concept'
        );
        const grab = (label: string) => {
          const m = new RegExp(`${label}\\s*:\\s*(.+)`, 'i').exec(raw || '');
          return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
        };
        concepts = labels.map(l => grab(l).slice(0, 400)).filter(Boolean);
        if (!concepts.length && raw?.trim()) concepts = [raw.trim().slice(0, 400)];
      } catch (_e) {
        /* concept generation is free and best-effort — falls back to the typed idea below */
      }
      // If the model returned fewer usable concepts than slots, cycle what
      // we did get rather than leaving later slots with nothing.
      const usableConcepts = concepts.length ? concepts : [topic];

      setNoteText('Designing your thumbnails…', 'info');
      let launched = 0;
      for (let i = 0; i < wantCount; i++) {
        const concept = usableConcepts[i % usableConcepts.length] || topic;
        const extra = concept ? `Extra direction: ${concept}. ` : '';
        const p = `Use the FIRST image — a rough hand-drawn sketch — ONLY as the exact layout and composition blueprint for the thumbnail: honour where each subject, object, arrow and text block is placed and its relative size and position. The sketch dictates LAYOUT ONLY, never the visual medium — do NOT keep the crude sketch lines, the plain white paper, or anything resembling a drawing, cartoon, illustration, digital painting, anime or clipart/vector-art style. Redraw it as an authentic, ultra-realistic photograph: real-camera depth of field, natural skin texture, realistic lighting and real, richly detailed photographic content in place of every sketched element — indistinguishable from a genuine photo taken by a professional camera for THIS exact topic. ${hasFace ? 'Use the additional uploaded photo for the main person and preserve their likeness, placing them where the sketch indicates. ' : ''}${styleDir}${extra}${topicDirective(promptText)}${textDirective(promptText)}${creativeMode ? 'Within the sketch\'s fixed layout, push the lighting, colour grade and mood toward the boldest, most dramatic and high-contrast take possible. ' : ''} ${BASE_THUMB}`;
        // Same source order as before: sketch (layout blueprint) first, then
        // any uploaded face photo, then the style reference last.
        const variantSources = styleB64 ? [sketchData, ...uploads, styleB64] : [sketchData, ...uploads];
        onGenerate(finalize(p), variantSources, genOpts);
        launched++;
      }
      setBusy(false);
      if (launched) { setNote(null); scrollToResults(); }
      return;
    } else {
      // reference ("Image" tab): same concept-first structure as the other
      // modes — design one distinct concept per requested variation instead
      // of generating every variation from the exact same shared prompt.
      const topic = titleText.trim();
      const hasFace = uploads.length > 0;
      const wantCount = Math.max(1, Math.min(4, genCount));
      const finalize = (p: string) => (format === 'short' ? p.replace(BASE_THUMB, BASE_SHORT) : p);
      const genOpts = { count: 1, modelType: QUALITY_MODEL[genModel], resolution: QUALITY_RESOLUTION[genModel], aspect: format === 'short' ? '9:16' : '16:9' };

      setNoteText(`Designing ${wantCount} fresh thumbnail concept${wantCount > 1 ? 's' : ''}…`, 'info');
      let concepts: string[] = [];
      try {
        const labels = Array.from({ length: wantCount }, (_, i) => `CONCEPT_${i + 1}`);
        const raw = await generateText(
          `You are a world-class YouTube thumbnail art director. A creator has uploaded reference photo(s) for style and mood inspiration, plus an optional direction below. Design ${wantCount} clearly DIFFERENT way${wantCount > 1 ? 's' : ''} to build a brand-new thumbnail inspired by that reference — each with a distinct composition, mood, lighting or real-world scene detail.\n\n` +
          `Rules:\n` +
          (wantCount > 1 ? `- Make all ${wantCount} genuinely distinct from EACH OTHER — not near-duplicates of the same look.\n` : '') +
          (creativeMode ? `- You have full creative freedom here — imagine it in whatever bold, unexpected, visually striking way feels right.\n` : '') +
          `- Each concept: ONE vivid sentence, concrete and purely visual.\n\n` +
          `Reply in EXACTLY this format, nothing else:\n` +
          `${labels.map(l => `${l}: <sentence>`).join('\n')}\n\n` +
          `DIRECTION: ${topic || "match the uploaded reference's own style and mood"}`,
          'concept'
        );
        const grab = (label: string) => {
          const m = new RegExp(`${label}\\s*:\\s*(.+)`, 'i').exec(raw || '');
          return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
        };
        concepts = labels.map(l => grab(l).slice(0, 400)).filter(Boolean);
        if (!concepts.length && raw?.trim()) concepts = [raw.trim().slice(0, 400)];
      } catch (_e) {
        /* concept generation is free and best-effort — falls back to the typed direction below */
      }
      // If the model returned fewer usable concepts than slots, cycle what
      // we did get rather than leaving later slots with nothing.
      const usableConcepts = concepts.length ? concepts : [topic];

      setNoteText('Designing your thumbnails…', 'info');
      let launched = 0;
      for (let i = 0; i < wantCount; i++) {
        const concept = usableConcepts[i % usableConcepts.length] || topic;
        const extra = concept ? `Concept: ${concept} ` : '';
        const p = `Using the uploaded reference image(s) as strong inspiration for style, mood and composition, create a brand-new original thumbnail (do not copy it exactly). ${hasFace ? 'If a person appears, preserve their likeness. ' : ''}${extra}${creativeDirective}${topicDirective(topic)}Do NOT add, invent or write any new text, letters, words, captions or labels anywhere on the image. ${BASE_THUMB}`;
        onGenerate(finalize(p), [...uploads], genOpts);
        launched++;
      }
      setBusy(false);
      if (launched) { setNote(null); scrollToResults(); }
      return;
    }

    // Shorts mode: swap the landscape base directive for the vertical one (every
    // mode appends BASE_THUMB verbatim, so one replace covers them all).
    if (format === 'short') prompt = prompt.replace(BASE_THUMB, BASE_SHORT);

    onGenerate(prompt, sources, { count: genCount, modelType: QUALITY_MODEL[genModel], resolution: QUALITY_RESOLUTION[genModel], aspect: format === 'short' ? '9:16' : '16:9' });
    scrollToResults();
  }, [canGenerate, mode, uploads, youtubeUrl, titleText, promptText, selectedTemplate, selectedRef, sketchData, selectedSketchStyle, selectedYtStyle, onlyMyStyles, creativeMode, accurateMode, format, genCount, genModel, onGenerate, configured, user, totalCredits, creditsLoading, refreshProfile]);

  // Fires the queued auto-generate (see startFromHome) once mode/youtubeUrl
  // have actually committed and handleGenerate's closure reflects them.
  useEffect(() => {
    if (!autoGenerateOnEntry) return;
    setAutoGenerateOnEntry(false);
    handleGenerate();
  }, [autoGenerateOnEntry, handleGenerate]);

  const sortedQueue = [...queue].sort((a, b) =>
    a.status === 'failed' ? 1 : b.status === 'failed' ? -1 : 0);

  // Feed-preview device frames
  const DEVICES: { id: 'desktop' | 'tablet' | 'mobile'; label: string }[] = [
    { id: 'desktop', label: 'Desktop' },
    { id: 'tablet', label: 'Tablet' },
    { id: 'mobile', label: 'Mobile' },
  ];
  const deviceConf = {
    desktop: { frame: 'max-w-5xl', cols: 'grid-cols-2 lg:grid-cols-3', gap: 'gap-x-4 gap-y-8' },
    tablet: { frame: 'max-w-2xl', cols: 'grid-cols-2', gap: 'gap-x-4 gap-y-7' },
    mobile: { frame: 'max-w-[400px]', cols: 'grid-cols-1', gap: 'gap-y-6' },
  }[previewDevice];

  return (
    <div className={`thumb-scope min-h-screen overflow-x-hidden bg-thumb-bg text-thumb-ink font-sans antialiased ${theme === 'light' ? 'thumb-light' : ''}`}>
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-thumb-bg/90 backdrop-blur-xl border-b border-thumb-line">
        <div className="max-w-6xl mx-auto px-5 h-[68px] flex items-center justify-between">
          <div className="flex items-center gap-7">
            <button onClick={goHome} className="flex items-center gap-2.5 shrink-0">
              <div className="thumb-btn w-10 h-10 rounded-[13px] flex items-center justify-center text-white shrink-0">
                <I.Wand className="w-5 h-5" />
              </div>
              <span className="hidden sm:inline text-xl font-extrabold tracking-tight whitespace-nowrap">PodcastFlux</span>
            </button>
            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {[
                { label: 'Thumbnail', on: goGenerate, active: section === 'generate' },
                { label: 'Editor', on: () => onOpenEditor(), active: false },
                { label: 'Titles', on: goTitle, active: section === 'title' },
                { label: 'Chapters', on: goChapters, active: section === 'chapters' },
                { label: 'Feed test', on: goPreview, active: section === 'preview' },
                { label: 'Pricing', on: goPricing, active: section === 'pricing' },
                ...(profile?.is_admin ? [{ label: 'Admin', on: goAdmin, active: section === 'admin' }] : []),
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.on}
                  className={`px-3.5 py-2 rounded-xl text-sm font-bold transition-colors ${item.active ? 'thumb-liquid' : 'text-thumb-sub hover:text-thumb-ink hover:bg-thumb-soft'}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            {configured && user ? (
              <>
                <button onClick={goPricing} title="Credits — tap to top up" className="h-11 inline-flex items-center gap-1.5 bg-thumb-soft border border-thumb-line rounded-xl pl-2.5 pr-3 text-sm font-bold text-thumb-ink hover:border-thumb-red/40 transition-colors">
                  <I.Bolt className="w-4 h-4 text-thumb-red" />
                  {creditsLoading
                    ? <span className="thumb-skeleton inline-block w-5 h-4 rounded align-middle" aria-label="Loading credits" />
                    : totalCredits}
                  <span className="hidden sm:inline text-thumb-sub font-semibold">credits</span>
                </button>
                <button onClick={goAccount} className="w-11 h-11 rounded-2xl bg-thumb-red text-white flex items-center justify-center text-sm font-black shrink-0 hover:ring-2 hover:ring-thumb-red/40 transition-all" title={user.email ?? undefined} aria-label="Account">
                  {(user.email?.[0] || 'U').toUpperCase()}
                </button>
              </>
            ) : (
              <>
                {configured && (
                  <button onClick={() => requireLogin()} className="h-11 inline-flex items-center whitespace-nowrap rounded-full border border-thumb-line px-3 sm:px-4 text-sm font-bold text-thumb-ink hover:border-thumb-red/40 hover:text-thumb-red transition-colors">
                    Log in
                  </button>
                )}
                <button onClick={goGenerate} className="h-11 inline-flex items-center whitespace-nowrap thumb-btn text-white font-bold text-sm px-3.5 sm:px-5 rounded-full">
                  Start now
                </button>
              </>
            )}
            <button onClick={() => setSidebarOpen(true)} className="w-11 h-11 shrink-0 inline-flex items-center justify-center rounded-full text-thumb-ink/70 hover:text-thumb-ink hover:bg-thumb-soft transition-colors" aria-label="Menu"><I.Menu className="w-6 h-6" /></button>
          </div>
        </div>
      </header>

      {/* ── Sidebar drawer (tools) ── */}
      <div className={`fixed inset-0 z-[60] overflow-hidden ${sidebarOpen ? '' : 'pointer-events-none'}`} aria-hidden={!sidebarOpen}>
        <div onClick={() => setSidebarOpen(false)} className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${sidebarOpen ? 'opacity-100' : 'opacity-0'}`} />
        <aside style={{ willChange: 'transform' }} className={`thumb-glass absolute top-0 left-0 h-full w-[290px] max-w-[82vw] flex flex-col transition-transform duration-[350ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="h-[68px] px-5 flex items-center justify-between border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="thumb-btn w-9 h-9 rounded-xl flex items-center justify-center text-white"><I.Wand className="w-4 h-4" /></div>
              <span className="font-extrabold tracking-tight">PodcastFlux</span>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 text-thumb-sub hover:text-thumb-ink" aria-label="Close menu"><I.X className="w-5 h-5" /></button>
          </div>

          {/* Theme switch — same solid pill used for Format/Variations/Quality
              elsewhere, instead of the translucent nav-pill style (that one's
              built for the bordered list items below, not a compact toggle;
              it read as a barely-visible, mismatched highlight here). */}
          <div className="px-3 pt-3 shrink-0">
            <SegmentedControl
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark', label: <><I.Moon className="w-4 h-4" /> Dark</> },
                { value: 'light', label: <><I.Sun className="w-4 h-4" /> Light</> },
              ]}
            />
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-2">
            <p className="px-2 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Menu</p>
            {([
              { key: 'home', label: 'Home', tag: 'Landing', icon: I.Wand, active: section === 'home', onClick: goHome },
              { key: 'generate', label: 'Generate', tag: 'Create', icon: I.Bolt, active: section === 'generate', onClick: goGenerate },
              { key: 'title', label: 'Title Generator', tag: 'Titles', icon: I.Text, active: section === 'title', onClick: goTitle },
              { key: 'chapters', label: 'Chapter Maker', tag: 'Timestamps', icon: I.List, active: section === 'chapters', onClick: goChapters },
              { key: 'preview', label: 'Preview', tag: 'Feed test', icon: I.Tv, active: section === 'preview', onClick: goPreview },
              { key: 'editor', label: 'Editor', tag: 'Canvas', icon: I.Edit, active: false, onClick: () => { setSidebarOpen(false); onOpenEditor(); } },
              { key: 'pricing', label: 'Pricing', tag: 'Plans', icon: I.Star, active: section === 'pricing', onClick: goPricing },
              { key: 'account', label: 'Account', tag: 'Profile', icon: I.Check, active: section === 'account', onClick: goAccount },
              ...(profile?.is_admin ? [{ key: 'admin', label: 'Admin', tag: 'Styles', icon: I.Grid, active: section === 'admin', onClick: goAdmin }] : []),
            ] as { key: string; label: string; tag: string; icon: (p: any) => React.ReactElement; active: boolean; onClick: () => void }[]).map(item => (
              <button
                key={item.key}
                onClick={item.onClick}
                className={`thumb-nav w-full flex items-center gap-3 pl-2.5 pr-3 py-2.5 rounded-2xl text-[14px] font-bold ${item.active ? 'thumb-nav-active text-thumb-ink' : 'text-thumb-ink'}`}
              >
                <span className={`thumb-nav-chip w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.active ? 'text-white' : 'text-thumb-ink'}`}>
                  <item.icon className="w-[18px] h-[18px]" />
                </span>
                {item.label}
                <span className={`ml-auto text-[10px] font-bold uppercase tracking-wide ${item.active ? 'text-thumb-red' : 'text-thumb-sub'}`}>{item.tag}</span>
              </button>
            ))}
          </nav>

          <div className="p-3 border-t border-white/10 shrink-0 space-y-2.5">
            {configured && user ? (
              <>
                <button onClick={goAccount} className="w-full flex items-center gap-2.5 p-1 rounded-xl hover:bg-white/5 transition-colors text-left">
                  <div className="w-9 h-9 rounded-xl bg-thumb-red text-white flex items-center justify-center text-sm font-black shrink-0">{(user.email?.[0] || 'U').toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-thumb-ink truncate">{user.email}</p>
                    <p className="text-[11px] text-thumb-sub flex items-center gap-1">
                      {creditsLoading
                        ? <span className="thumb-skeleton inline-block w-6 h-3 rounded align-middle" aria-label="Loading credits" />
                        : totalCredits}
                      {' '}credits · {profile?.plan ?? 'free'}
                    </p>
                  </div>
                </button>
                <button onClick={goPricing} className="thumb-btn w-full text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm">
                  <I.Bolt className="w-4 h-4" /> Upgrade / buy credits
                </button>
                <button onClick={() => { signOut(); setSidebarOpen(false); }} className="w-full py-2.5 rounded-xl text-sm font-bold text-thumb-sub bg-white/5 border border-white/10 hover:text-thumb-red transition-colors">
                  Sign out
                </button>
              </>
            ) : (
              <>
                <button onClick={() => requireLogin()} className="thumb-btn w-full text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 text-sm">
                  <I.Check className="w-4 h-4" /> Log in with Google
                </button>
                <button onClick={() => goToMode(mode)} className="w-full py-2.5 rounded-xl text-sm font-bold text-thumb-ink bg-white/5 border border-white/10 hover:border-thumb-red/40 transition-colors flex items-center justify-center gap-2">
                  <I.Wand className="w-4 h-4" /> Generate Thumbnails
                </button>
              </>
            )}
          </div>
        </aside>
      </div>

      <main className="max-w-6xl mx-auto px-5">
        {/* ── Hero (clean landing) ── */}
        {section === 'home' && (
        <section className="pt-14 sm:pt-20 lg:pt-24 pb-12 text-center">
          {/* 3-word heading — plain ink words + one glowing liquid-glass PREMIUM */}
          <h1 className="text-[2rem] sm:text-[3rem] lg:text-[3.6rem] font-black uppercase leading-[1.05] tracking-[-0.02em]">
            <span className="text-thumb-ink">Generate</span>{' '}
            <span
              className="liquid-text"
              style={{
                backgroundImage: 'linear-gradient(180deg, #ffffff 0%, #ffc7d1 18%, #ff3b5c 50%, #a30d28 100%)',
                filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.18)) drop-shadow(0 0 16px rgba(255,59,92,0.6)) drop-shadow(0 0 38px rgba(255,59,92,0.4))',
              }}
            >Premium</span>{' '}
            <span className="text-thumb-ink">Thumbnails</span>
          </h1>

          {/* Kept for SEO/crawlers (matches index.html's meta description) —
              visually hidden since it read as redundant filler directly under
              the hero heading. */}
          <p className="sr-only">
            The best free AI thumbnail maker for YouTube — make high-quality thumbnails with AI from a prompt, photo, or YouTube video link. No Photoshop or Adobe Express needed. Also turns any YouTube link into AI titles &amp; timestamps.
          </p>

          {/* One clean prompt box — click sends you into the generator and starts */}
          <div className="mt-9 max-w-3xl mx-auto text-left">
            <div className="thumb-glass thumb-float-red rounded-[28px] p-3.5 sm:p-4">
              <textarea
                value={promptText}
                onChange={e => setPromptText(e.target.value)}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') startFromHome(); }}
                rows={3}
                placeholder="Describe your video, or paste a YouTube link…"
                className="w-full bg-transparent px-3 pt-3 pb-3 outline-none text-[16px] sm:text-[17px] placeholder-thumb-sub/40 resize-none"
              />
              <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
                <button
                  onClick={startFromHome}
                  className="thumb-btn flex-1 py-4 rounded-2xl text-white font-black text-lg flex items-center justify-center gap-3"
                >
                  <I.Wand className="w-5 h-5" /> Generate My First Thumbnail
                </button>
              </div>
            </div>
            {/* Trust row */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-thumb-sub">
              <span className="inline-flex items-center gap-1.5"><I.Check className="w-4 h-4 text-thumb-green" /> Pro-grade AI models</span>
              <span className="inline-flex items-center gap-1.5"><I.Check className="w-4 h-4 text-thumb-green" /> 4K · 16:9 exports</span>
              {/* Plans are a one-time purchase, not a recurring subscription
                  (see dodo-webhook) — there's no auto-renewal to "cancel" in
                  the first place, so that claim was inaccurate. This is the
                  truthful version of the same reassurance. */}
              <span className="inline-flex items-center gap-1.5"><I.Check className="w-4 h-4 text-thumb-green" /> No auto-renewal</span>
            </div>
          </div>
        </section>
        )}

        {/* ── Generator tool (Generate section) ── */}
        {section === 'generate' && (
        <section id="thumb-tool" className="scroll-mt-24 pt-10 pb-12">
          <div className="grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-6 lg:gap-8 items-start max-w-6xl mx-auto">
          {/* LEFT: generator controls */}
          <div className="thumb-glass thumb-float-red rounded-[28px] p-5 sm:p-8 max-w-3xl mx-auto w-full lg:max-w-none lg:sticky lg:top-24 lg:self-start">
            {/* No card header here on purpose — the top nav already shows the
                "Thumbnail" tab as active, so repeating "AI Thumbnail
                Generator" just duplicated that and pushed the actual tools
                further down, costing an extra scroll for nothing. */}

            {/* Tabs */}
            {/* Every tab is the same fixed-width grid cell at all times (icon +
                label, always both visible) — nothing ever grows or shrinks on
                selection, so there's no layout measurement to race against
                (no delayed/missing highlight on first paint, no reflow jank on
                switch, and "YouTube" always has exactly as much room as every
                other tab). The highlight is a plain per-button opacity
                cross-fade, not a JS-measured sliding box. */}
            <div className="grid grid-cols-5 gap-1 p-1.5 bg-thumb-soft border border-thumb-line rounded-2xl">
              {TABS.map(t => {
                const active = mode === t.id;
                return (
                  <button
                    key={t.id}
                    title={t.label}
                    aria-label={t.label}
                    aria-pressed={active}
                    onClick={() => {
                      // Each tab is its own independent input — don't let one section's
                      // typed prompt/title leak into another (e.g. into YouTube generate).
                      if (t.id !== mode) { setPromptText(''); setTitleText(''); }
                      setMode(t.id);
                      setNote(null);
                    }}
                    className={`relative flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl text-[10px] sm:text-[11px] font-bold transition-colors duration-150 ${
                      active ? 'text-white' : 'text-thumb-sub hover:text-thumb-ink'
                    }`}
                  >
                    <span aria-hidden className={`absolute inset-0 rounded-xl thumb-liquid transition-opacity duration-150 pointer-events-none ${active ? 'opacity-100' : 'opacity-0'}`} />
                    <t.icon className="relative z-10 w-4 h-4 shrink-0" />
                    <span className="relative z-10 whitespace-nowrap">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Panels */}
            <div className="mt-6 space-y-5">
              {mode === 'youtube' && (
                <div className="space-y-4 animate-fade-in-up">
                  <div className="space-y-2.5">
                    <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">YouTube video link</label>
                    <div className="flex items-center gap-3 bg-thumb-soft border border-thumb-line rounded-2xl px-4 transition-all focus-within:border-thumb-red/50 focus-within:ring-4 focus-within:ring-thumb-red/10">
                      <I.Youtube className="w-5 h-5 text-thumb-red shrink-0" />
                      <input
                        value={youtubeUrl}
                        onChange={e => setYoutubeUrl(e.target.value)}
                        placeholder="youtu.be/gO0bvT_smdM"
                        className="w-full bg-transparent py-4 outline-none text-[15px] placeholder-thumb-sub/50"
                      />
                    </div>
                  </div>

                  {/* Advanced (optional) */}
                  <div className="border-t border-white/10 pt-3">
                    <button
                      type="button"
                      onClick={() => setYtAdvanced(v => !v)}
                      className="w-full group flex items-center justify-between gap-2 pl-2 pr-3.5 py-2.5 rounded-xl bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-thumb-redSoft text-thumb-red flex items-center justify-center shrink-0"><I.Sliders className="w-3.5 h-3.5" /></span>
                        <span className="text-[13px] font-bold text-thumb-ink">Advanced</span>
                      </span>
                      <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-thumb-sub group-hover:text-thumb-red transition-all shrink-0 ${ytAdvanced ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    </button>

                    {ytAdvanced && (
                      <div className="mt-3 space-y-3 animate-fade-in-up">
                        <div className="space-y-2">
                          <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Describe what you want</label>
                          <textarea
                            value={promptText}
                            onChange={e => setPromptText(e.target.value)}
                            rows={3}
                            placeholder="e.g. Keep it bold and cinematic, red/black colors, show a shocked face and the text 'GONE WRONG'…"
                            className="w-full bg-thumb-soft border border-thumb-line rounded-2xl px-4 py-3.5 outline-none text-sm placeholder-thumb-sub/50 transition-all focus:border-thumb-red/50 focus:ring-4 focus:ring-thumb-red/10 resize-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Extras (optional)</label>
                            {selectedYtStyle && (
                              <button type="button" onClick={() => setSelectedYtStyle(null)} className="text-[11px] font-bold text-thumb-red hover:underline">
                                Auto-match style instead
                              </button>
                            )}
                          </div>
                          {uploads.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                              {uploads.map((u, i) => (
                                <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-thumb-line group">
                                  <img src={u} alt="" className="w-full h-full object-cover" />
                                  <button onClick={() => setUploads(prev => prev.filter((_, x) => x !== i))} aria-label={`Remove photo ${i + 1}`} className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><I.X className="w-3 h-3" /></button>
                                  {user && <button onClick={() => saveAsPersona(u)} title="Save face" aria-label="Save this face for reuse" className="absolute bottom-0.5 right-0.5 w-5 h-5 bg-black/60 hover:bg-thumb-red text-white rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><I.Star className="w-3 h-3" /></button>}
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Same three equal-size buttons as Sketch mode — each acts
                              immediately (opens its popup or the native file picker). */}
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => { if (configured && !user) { requireLogin('Log in to use saved faces.'); return; } setPersonaModalOpen(true); }}
                              className="h-16 rounded-xl border-2 border-dashed border-white/12 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-thumb-sub hover:border-thumb-red hover:text-thumb-red transition-colors"
                            >
                              <I.FaceSwap className="w-4 h-4" /> Persona
                            </button>
                            <button
                              type="button"
                              onClick={() => setStyleModalOpen('youtube')}
                              className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors ${selectedYtStyle ? 'border-thumb-red text-thumb-red bg-thumb-redSoft' : 'border-dashed border-white/12 text-thumb-sub hover:border-thumb-red hover:text-thumb-red'}`}
                            >
                              <I.Image className="w-4 h-4" /> Style
                            </button>
                            <button
                              type="button"
                              onClick={triggerUpload}
                              className="h-16 rounded-xl border-2 border-dashed border-white/12 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-thumb-sub hover:border-thumb-red hover:text-thumb-red transition-colors"
                            >
                              <I.Upload className="w-4 h-4" /> Upload
                            </button>
                            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-bold text-thumb-ink">Only use my custom styles</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={onlyMyStyles}
                            aria-label="Only use my custom styles"
                            disabled={!!selectedYtStyle}
                            onClick={() => setOnlyMyStyles(v => !v)}
                            className={`shrink-0 w-11 h-6 rounded-full border transition-colors disabled:opacity-40 ${onlyMyStyles ? 'bg-thumb-red border-thumb-red' : 'bg-thumb-soft border-thumb-line'}`}
                          >
                            <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${onlyMyStyles ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                          </button>
                        </div>
                        {onlyMyStyles && (
                          <p className="text-[11px] text-thumb-sub -mt-1">Only your own uploaded styles will be used — nothing else.</p>
                        )}

                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-bold text-thumb-ink">Creative concepts</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={creativeMode}
                            aria-label="Creative concepts"
                            onClick={() => setCreativeMode(v => !v)}
                            className={`shrink-0 w-11 h-6 rounded-full border transition-colors ${creativeMode ? 'bg-thumb-red border-thumb-red' : 'bg-thumb-soft border-thumb-line'}`}
                          >
                            <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${creativeMode ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                          </button>
                        </div>
                        {creativeMode && (
                          <p className="text-[11px] text-thumb-sub -mt-1">Bolder, more visually unique and dramatic concepts — less predictable than the standard look.</p>
                        )}

                        <div className="space-y-1.5">
                          <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Quality</label>
                          <SegmentedControl
                            value={genModel}
                            onChange={setGenModel}
                            options={[{ value: 'fast', label: 'Fast' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }]}
                          />
                          <p className="text-[11px] text-thumb-sub">Fast (1K) is quickest; 2K (default) uses our higher-end model for sharper thumbnails. 4K is our highest resolution and costs {RES_SURCHARGE_4K} extra credits per thumbnail.</p>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-bold text-thumb-ink">Stick to video's topics</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={accurateMode}
                            aria-label="Stick to video's topics"
                            onClick={() => setAccurateMode(v => !v)}
                            className={`shrink-0 w-11 h-6 rounded-full border transition-colors ${accurateMode ? 'bg-thumb-red border-thumb-red' : 'bg-thumb-soft border-thumb-line'}`}
                          >
                            <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${accurateMode ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                          </button>
                        </div>

                        {/* Format lives here (not always visible) — YouTube
                            is overwhelmingly 16:9, so it doesn't need to be
                            front and center every time. */}
                        <div className="space-y-1.5">
                          <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Format</label>
                          <SegmentedControl
                            value={format}
                            onChange={setFormat}
                            options={[
                              { value: 'thumb', label: <><span className="w-5 h-3 rounded-[3px] border-2 border-current shrink-0" /> Thumbnail <span className="text-[10px] font-semibold opacity-70">16:9</span></> },
                              { value: 'short', label: <><span className="w-3 h-4 rounded-[3px] border-2 border-current shrink-0" /> Shorts <span className="text-[10px] font-semibold opacity-70">9:16</span></> },
                            ]}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {mode === 'templates' && (
                <div className="space-y-3 animate-fade-in-up">
                  {/* Single style picker: tap a REAL thumbnail and the AI recreates
                      its exact look (style, layout, lighting, colors) for your topic. */}
                  <label className="text-sm font-bold text-thumb-ink flex items-center gap-2">
                    <I.Image className="w-4 h-4 text-thumb-red" /> Pick a style to recreate
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[300px] overflow-y-auto no-scrollbar pr-0.5 -mr-0.5">
                    {styleImages.map(src => {
                      const active = selectedRef === src;
                      return (
                        <button
                          key={src}
                          onClick={() => setSelectedRef(src)}
                          className={`relative aspect-video rounded-2xl overflow-hidden border-2 bg-black/40 transition-all ${active ? 'border-thumb-red shadow-md' : 'border-transparent hover:border-thumb-line'}`}
                        >
                          <img src={src} alt="Style reference" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                          {active && <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-thumb-red text-white flex items-center justify-center text-[11px] font-bold">✓</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {mode === 'prompt' && (
                <div className="space-y-3 animate-fade-in-up">
                  <div className="space-y-2.5">
                    <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Describe your thumbnail idea</label>
                    <textarea
                      value={promptText}
                      onChange={e => setPromptText(e.target.value)}
                      rows={4}
                      placeholder="Tell us about your video and the thumbnail you want — e.g. A gaming video about a crazy comeback; I want a shocked gamer with a glowing headset, explosion behind, neon RGB lighting, and the text 'INSANE COMEBACK'."
                      className="w-full bg-thumb-soft border border-thumb-line rounded-2xl px-4 py-4 outline-none text-[15px] placeholder-thumb-sub/50 transition-all focus:border-thumb-red/50 focus:ring-4 focus:ring-thumb-red/10 resize-none"
                    />
                  </div>

                  <div className="border-t border-white/10 pt-3">
                    <button
                      type="button"
                      onClick={() => setPromptAdvanced(v => !v)}
                      className="w-full group flex items-center justify-between gap-2 pl-2 pr-3.5 py-2.5 rounded-xl bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-thumb-redSoft text-thumb-red flex items-center justify-center shrink-0"><I.Sliders className="w-3.5 h-3.5" /></span>
                        <span className="text-[13px] font-bold text-thumb-ink">Advanced</span>
                      </span>
                      <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-thumb-sub group-hover:text-thumb-red transition-all shrink-0 ${promptAdvanced ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    </button>

                    {promptAdvanced && (
                      <div className="mt-3 space-y-4 animate-fade-in-up">
                        <div className="space-y-1.5">
                          <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Persona &amp; upload</label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => { if (configured && !user) { requireLogin('Log in to use saved faces.'); return; } setPersonaModalOpen(true); }}
                              className="h-16 rounded-xl border-2 border-dashed border-white/12 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-thumb-sub hover:border-thumb-red hover:text-thumb-red transition-colors"
                            >
                              <I.FaceSwap className="w-4 h-4" /> Persona
                            </button>
                            <button
                              type="button"
                              onClick={triggerUpload}
                              className="h-16 rounded-xl border-2 border-dashed border-white/12 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-thumb-sub hover:border-thumb-red hover:text-thumb-red transition-colors"
                            >
                              <I.Upload className="w-4 h-4" /> Upload
                            </button>
                            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-bold text-thumb-ink">Creative concepts</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={creativeMode}
                            aria-label="Creative concepts"
                            onClick={() => setCreativeMode(v => !v)}
                            className={`shrink-0 w-11 h-6 rounded-full border transition-colors ${creativeMode ? 'bg-thumb-red border-thumb-red' : 'bg-thumb-soft border-thumb-line'}`}
                          >
                            <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${creativeMode ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                          </button>
                        </div>
                        {creativeMode && (
                          <p className="text-[11px] text-thumb-sub mt-1.5">Bolder, more visually unique and dramatic concepts — less predictable than the standard look.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {mode === 'reference' && (
                <div className="space-y-2.5 animate-fade-in-up">
                  <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Upload reference or your photo</label>
                  <div
                    onClick={triggerUpload}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); dropFiles(Array.from(e.dataTransfer.files)); }}
                    className="border-2 border-dashed border-white/12 rounded-2xl p-7 flex flex-col items-center justify-center gap-2.5 text-thumb-sub hover:border-thumb-red hover:text-thumb-red cursor-pointer transition-all bg-black/20"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center"><I.Upload className="w-5 h-5" /></div>
                    <span className="text-sm font-bold">Click or drag to upload</span>
                    <span className="text-xs text-thumb-sub/80">Up to 4 images · PNG or JPG</span>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />

                  <div className="border-t border-white/10 pt-3">
                    <button
                      type="button"
                      onClick={() => setReferenceAdvanced(v => !v)}
                      className="w-full group flex items-center justify-between gap-2 pl-2 pr-3.5 py-2.5 rounded-xl bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-thumb-redSoft text-thumb-red flex items-center justify-center shrink-0"><I.Sliders className="w-3.5 h-3.5" /></span>
                        <span className="text-[13px] font-bold text-thumb-ink">Advanced</span>
                      </span>
                      <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-thumb-sub group-hover:text-thumb-red transition-all shrink-0 ${referenceAdvanced ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    </button>

                    {referenceAdvanced && (
                      <div className="mt-3 animate-fade-in-up">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[13px] font-bold text-thumb-ink">Creative concepts</span>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={creativeMode}
                            aria-label="Creative concepts"
                            onClick={() => setCreativeMode(v => !v)}
                            className={`shrink-0 w-11 h-6 rounded-full border transition-colors ${creativeMode ? 'bg-thumb-red border-thumb-red' : 'bg-thumb-soft border-thumb-line'}`}
                          >
                            <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${creativeMode ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                          </button>
                        </div>
                        {creativeMode && (
                          <p className="text-[11px] text-thumb-sub mt-1.5">Bolder, more exaggerated staging — less predictable than the standard look.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {mode === 'sketch' && (
                <div className="space-y-4 animate-fade-in-up">
                  <div className="space-y-2.5">
                    <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Sketch your thumbnail layout</label>
                    <SketchCanvas onChange={setSketchData} />
                  </div>

                  <div className="space-y-2.5">
                    <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Describe it &amp; the title text</label>
                    <textarea
                      value={promptText}
                      onChange={e => setPromptText(e.target.value)}
                      rows={2}
                      placeholder="e.g. 'gaming video, shocked player, explosion behind, neon colors, text: INSANE COMEBACK'"
                      className="w-full bg-thumb-soft border border-thumb-line rounded-2xl px-4 py-3.5 outline-none text-sm placeholder-thumb-sub/50 transition-all focus:border-thumb-red/50 focus:ring-4 focus:ring-thumb-red/10 resize-none"
                    />
                  </div>

                  {/* Advanced (optional) — same collapsed-by-default pattern as
                      YouTube mode. Sketch is overwhelmingly 16:9 thumbnails and
                      most sketches don't need a persona/style/upload on top, so
                      none of that needs to sit in the always-visible path
                      between the canvas and the Generate button. */}
                  <div className="border-t border-white/10 pt-3">
                    <button
                      type="button"
                      onClick={() => setSketchAdvanced(v => !v)}
                      className="w-full group flex items-center justify-between gap-2 pl-2 pr-3.5 py-2.5 rounded-xl bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 transition-all"
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-6 h-6 rounded-full bg-thumb-redSoft text-thumb-red flex items-center justify-center shrink-0"><I.Sliders className="w-3.5 h-3.5" /></span>
                        <span className="text-[13px] font-bold text-thumb-ink">Advanced</span>
                      </span>
                      <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-thumb-sub group-hover:text-thumb-red transition-all shrink-0 ${sketchAdvanced ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                    </button>

                    {sketchAdvanced && (
                      <div className="mt-3 space-y-4 animate-fade-in-up">
                        <div className="space-y-1.5">
                          <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Format</label>
                          <SegmentedControl
                            value={format}
                            onChange={setFormat}
                            options={[
                              { value: 'thumb', label: <><span className="w-5 h-3 rounded-[3px] border-2 border-current shrink-0" /> Thumbnail <span className="text-[10px] font-semibold opacity-70">16:9</span></> },
                              { value: 'short', label: <><span className="w-3 h-4 rounded-[3px] border-2 border-current shrink-0" /> Shorts <span className="text-[10px] font-semibold opacity-70">9:16</span></> },
                            ]}
                          />
                        </div>

                        {/* Three equal-size entry points — each acts immediately
                            (opens its popup or the native file picker) instead
                            of expanding an inline panel that needs a second tap. */}
                        <div className="space-y-1.5">
                          <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Persona, style &amp; upload</label>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => { if (configured && !user) { requireLogin('Log in to use saved faces.'); return; } setPersonaModalOpen(true); }}
                              className="h-16 rounded-xl border-2 border-dashed border-white/12 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-thumb-sub hover:border-thumb-red hover:text-thumb-red transition-colors"
                            >
                              <I.FaceSwap className="w-4 h-4" /> Persona
                            </button>
                            <button
                              type="button"
                              onClick={() => setStyleModalOpen('sketch')}
                              className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors ${selectedSketchStyle ? 'border-thumb-red text-thumb-red bg-thumb-redSoft' : 'border-dashed border-white/12 text-thumb-sub hover:border-thumb-red hover:text-thumb-red'}`}
                            >
                              <I.Image className="w-4 h-4" /> Style
                            </button>
                            <button
                              type="button"
                              onClick={triggerUpload}
                              className="h-16 rounded-xl border-2 border-dashed border-white/12 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-thumb-sub hover:border-thumb-red hover:text-thumb-red transition-colors"
                            >
                              <I.Upload className="w-4 h-4" /> Upload
                            </button>
                            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[13px] font-bold text-thumb-ink">Creative concepts</span>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={creativeMode}
                              aria-label="Creative concepts"
                              onClick={() => setCreativeMode(v => !v)}
                              className={`shrink-0 w-11 h-6 rounded-full border transition-colors ${creativeMode ? 'bg-thumb-red border-thumb-red' : 'bg-thumb-soft border-thumb-line'}`}
                            >
                              <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${creativeMode ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                            </button>
                          </div>
                          {creativeMode && (
                            <p className="text-[11px] text-thumb-sub mt-1.5">Bolder, more exaggerated mood/lighting within the sketch's layout — less predictable than the standard look.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Saved faces (shared for templates + reference) — sketch and
                  prompt each have their own toggled Persona panel above
                  instead (opens the full add-or-pick modal via the "Persona"
                  tile, rather than this reduced pick-only inline strip). */}
              {(mode === 'reference' || mode === 'templates') && (
                <PersonaPicker enabled onPick={pickPersona} refreshKey={personaRefreshKey} loggedIn={!configured || !!user} onRequireLogin={() => requireLogin('Log in to save faces.')} showAddTile={false} />
              )}

              {/* Uploaded thumbnails preview (shared across every mode that can carry a photo) */}
              {(mode === 'reference' || mode === 'templates' || mode === 'prompt' || mode === 'sketch') && uploads.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {uploads.map((u, i) => (
                    <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-thumb-line group">
                      <img src={u} alt="" className="w-full h-full object-cover" />
                      <button onClick={() => setUploads(prev => prev.filter((_, x) => x !== i))} aria-label={`Remove photo ${i + 1}`} className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 text-white rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><I.X className="w-3 h-3" /></button>
                      {user && <button onClick={() => saveAsPersona(u)} title="Save face" aria-label="Save this face for reuse" className="absolute bottom-0.5 right-0.5 w-5 h-5 bg-black/60 hover:bg-thumb-red text-white rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"><I.Star className="w-3 h-3" /></button>}
                    </div>
                  ))}
                </div>
              )}

              {/* templates + reference = single edit/direction instruction (optional).
                  sketch no longer uses this — its title text is now part of the
                  single description field above. */}
              {(mode === 'templates' || mode === 'reference') && (
                <div className="space-y-2.5">
                  <input
                    value={titleText}
                    onChange={e => setTitleText(e.target.value)}
                    placeholder={mode === 'templates' ? "e.g. A gaming video about a crazy comeback" : "e.g. Replace the face with my photo · change the title to 'MODI JI'"}
                    className="w-full bg-thumb-soft border border-thumb-line rounded-2xl px-4 py-4 outline-none text-[15px] placeholder-thumb-sub/50 transition-all focus:border-thumb-red/50 focus:ring-4 focus:ring-thumb-red/10"
                  />
                </div>
              )}

              {/* Format: 16:9 thumbnail vs 9:16 Shorts — for YouTube, Sketch and
                  Styles this lives inside their own Advanced sections instead
                  (see below), since 16:9 is the overwhelmingly common case and
                  doesn't need to be front and center every time — every extra
                  always-visible control here is more scrolling to reach
                  Generate. */}
              {mode !== 'youtube' && mode !== 'sketch' && mode !== 'templates' && (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Format</label>
                  <SegmentedControl
                    value={format}
                    onChange={setFormat}
                    options={[
                      { value: 'thumb', label: <><span className="w-5 h-3 rounded-[3px] border-2 border-current shrink-0" /> Thumbnail <span className="text-[10px] font-semibold opacity-70">16:9</span></> },
                      { value: 'short', label: <><span className="w-3 h-4 rounded-[3px] border-2 border-current shrink-0" /> Shorts <span className="text-[10px] font-semibold opacity-70">9:16</span></> },
                    ]}
                  />
                </div>
              )}

              {/* Output options. YouTube mode shows only Variations here —
                  its Quality control lives inside Advanced instead (below
                  Creative concepts), since it's a resolution choice worth a
                  second's thought, not a glance-and-tap like Variations. */}
              {mode !== 'templates' && (
                <div className={mode === 'youtube' ? '' : 'grid grid-cols-2 gap-2.5'}>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Variations</label>
                    <SegmentedControl
                      value={String(genCount)}
                      onChange={(v) => setGenCount(Number(v))}
                      options={[1, 2, 3, 4].map(n => ({ value: String(n), label: n }))}
                    />
                  </div>
                  {mode !== 'youtube' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Quality</label>
                      <SegmentedControl
                        value={genModel}
                        onChange={setGenModel}
                        options={[{ value: 'fast', label: 'Fast' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }]}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Styles mode tucks Format/Variations/Quality into the same
                  collapsed-by-default Advanced pattern as YouTube and Sketch —
                  the style grid + "What to change" note are the only things
                  that need to be front and center here. */}
              {mode === 'templates' && (
                <div className="border-t border-white/10 pt-3">
                  <button
                    type="button"
                    onClick={() => setTemplatesAdvanced(v => !v)}
                    className="w-full group flex items-center justify-between gap-2 pl-2 pr-3.5 py-2.5 rounded-xl bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 transition-all"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-thumb-redSoft text-thumb-red flex items-center justify-center shrink-0"><I.Sliders className="w-3.5 h-3.5" /></span>
                      <span className="text-[13px] font-bold text-thumb-ink">Advanced</span>
                    </span>
                    <svg viewBox="0 0 24 24" className={`w-3.5 h-3.5 text-thumb-sub group-hover:text-thumb-red transition-all shrink-0 ${templatesAdvanced ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                  </button>

                  {templatesAdvanced && (
                    <div className="mt-3 space-y-3 animate-fade-in-up">
                      <div className="space-y-1.5">
                        <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Format</label>
                        <SegmentedControl
                          value={format}
                          onChange={setFormat}
                          options={[
                            { value: 'thumb', label: <><span className="w-5 h-3 rounded-[3px] border-2 border-current shrink-0" /> Thumbnail <span className="text-[10px] font-semibold opacity-70">16:9</span></> },
                            { value: 'short', label: <><span className="w-3 h-4 rounded-[3px] border-2 border-current shrink-0" /> Shorts <span className="text-[10px] font-semibold opacity-70">9:16</span></> },
                          ]}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Variations</label>
                          <SegmentedControl
                            value={String(genCount)}
                            onChange={(v) => setGenCount(Number(v))}
                            options={[1, 2, 3, 4].map(n => ({ value: String(n), label: n }))}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Quality</label>
                          <SegmentedControl
                            value={genModel}
                            onChange={setGenModel}
                            options={[{ value: 'fast', label: 'Fast' }, { value: '2k', label: '2K' }, { value: '4k', label: '4K' }]}
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[13px] font-bold text-thumb-ink">Creative concepts</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={creativeMode}
                          aria-label="Creative concepts"
                          onClick={() => setCreativeMode(v => !v)}
                          className={`shrink-0 w-11 h-6 rounded-full border transition-colors ${creativeMode ? 'bg-thumb-red border-thumb-red' : 'bg-thumb-soft border-thumb-line'}`}
                        >
                          <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${creativeMode ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
                        </button>
                      </div>
                      {creativeMode && (
                        <p className="text-[11px] text-thumb-sub -mt-1">Bolder, more visually unique and dramatic concepts — less predictable than the standard look.</p>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Sticky footer — the Generate button (and its status note) stays
                reachable at the bottom of the viewport as you scroll through a
                tall config (e.g. an expanded Advanced section) instead of
                requiring extra scrolling past it every time. Bleeds to the
                panel's own edges/corners via negative margins since it sits
                inside the panel's padding. */}
            <div className="sticky bottom-0 z-10 -mx-5 sm:-mx-8 -mb-5 sm:-mb-8 mt-5 px-5 sm:px-8 pb-5 sm:pb-8 pt-4 rounded-b-[28px] thumb-glass-footer">
              {note && (
                <div className={`text-xs rounded-xl px-4 py-3 mb-3 leading-relaxed border ${
                  note.kind === 'success' ? 'bg-thumb-greenSoft text-thumb-green border-thumb-green/30'
                  : note.kind === 'info' ? 'bg-thumb-soft text-thumb-sub border-thumb-line'
                  : 'bg-thumb-redSoft text-red-300 border-thumb-red/20'
                }`}>{note.text}</div>
              )}

              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="thumb-btn w-full py-4 rounded-2xl text-white font-black text-lg flex items-center justify-center gap-3 disabled:text-white/70"
              >
                {busy ? (
                  <>
                    <span className="flex items-center gap-1 h-5">
                      <span className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </span>
                    Fetching…
                  </>
                ) : (
                  <><I.Wand className="w-5 h-5" /> Generate Thumbnails</>
                )}
              </button>
            </div>
          </div>

          {/* RIGHT: generated thumbnails */}
          <div ref={resultsRef} className="scroll-mt-24 min-w-0">
            {(generatedImages.length > 0 || queue.length > 0) ? (
              // Same frosted "canvas" surface (.thumb-glass) and generous
              // min-height as the nano-editor's own results canvas — a flat
              // bg-thumb-soft box here made every card blend into one flat
              // gray slab instead of reading as cards sitting on a canvas.
              // No fixed max-height/overflow-y-auto though — it still grows
              // with its content and scrolls with the page.
              <div className="thumb-glass rounded-[28px] p-4 sm:p-6 min-h-[60vh] lg:min-h-[calc(100vh-3rem)]">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {sortedQueue.map(item => (
                    <div key={item.id} className="aspect-video rounded-2xl bg-thumb-soft border border-thumb-line flex flex-col items-center justify-center gap-2 overflow-hidden p-4 text-center">
                      {item.status === 'processing' ? (
                        (() => {
                          const t = itemTimers[item.id] || 0;
                          const stepIndex = Math.min(GEN_STEPS.length - 1, Math.floor(t / 4));
                          return (
                            <div className="w-full px-2">
                              <div className="flex items-center justify-center gap-2 mb-3">
                                <span className="w-5 h-5 border-2 border-thumb-red border-t-transparent rounded-full animate-spin" />
                                <span className="text-thumb-red font-mono text-sm">{t.toFixed(1)}s</span>
                              </div>
                              <div className="space-y-1.5 text-left max-w-[210px] mx-auto">
                                {GEN_STEPS.map((s, i) => {
                                  const done = i < stepIndex;
                                  const active = i === stepIndex;
                                  return (
                                    <div key={i} className={`flex items-center gap-2 text-[11px] transition-colors ${done ? 'text-thumb-sub' : active ? 'text-thumb-ink font-semibold' : 'text-thumb-sub/40'}`}>
                                      <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                                        {done
                                          ? <I.Check className="w-4 h-4 text-thumb-red" />
                                          : active
                                            ? <span className="w-2 h-2 bg-thumb-red rounded-full animate-pulse" />
                                            : <span className="w-2 h-2 bg-thumb-sub/30 rounded-full" />}
                                      </span>
                                      {s}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })()
                      ) : item.status === 'failed' ? (
                        <>
                          <div className="w-10 h-10 rounded-full bg-thumb-redSoft text-thumb-red flex items-center justify-center text-xl">!</div>
                          <span className="text-sm font-bold">Generation failed</span>
                          <div className="flex items-center gap-2 mt-1">
                            <button onClick={() => onRetry(item)} className="thumb-btn px-4 py-2 rounded-xl text-white text-xs font-bold inline-flex items-center gap-1.5">
                              <I.Wand className="w-3.5 h-3.5" /> Retry
                            </button>
                            <button onClick={() => onCancel(item.id)} className="px-4 py-2 rounded-xl text-xs font-bold text-thumb-sub bg-white/5 border border-white/10 hover:text-thumb-ink transition-colors">
                              Dismiss
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="w-7 h-7 border-2 border-thumb-sub/40 border-dotted rounded-full animate-pulse" />
                          <span className="text-xs font-bold text-thumb-sub uppercase tracking-widest">Queued</span>
                        </>
                      )}
                    </div>
                  ))}

                  {generatedImages.slice(0, visibleCount).map(img => (
                    <ResultThumb
                      key={img.id}
                      img={img}
                      onView={onView}
                      onDownload={onDownload}
                      onOpenEditor={onOpenEditor}
                      onChangeFace={setChangeFaceTarget}
                      onDelete={onDelete}
                    />
                  ))}

                  {visibleCount < generatedImages.length && (
                    // Skeleton cards instead of a spinner — sized/gridded exactly
                    // like the real ResultThumb cards above (same grid-cols-1
                    // sm:grid-cols-2 the parent uses, so it's naturally 1-wide on
                    // mobile and 2-wide on desktop) so "more thumbnails incoming"
                    // reads clearly instead of looking like a stalled fetch.
                    <div ref={loadMoreRef} role="status" className="col-span-full grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Loading more thumbnails">
                      {Array.from({ length: Math.min(PAGE, generatedImages.length - visibleCount) }).map((_, i) => (
                        <div key={i} className="aspect-video rounded-2xl overflow-hidden border border-thumb-line bg-thumb-card">
                          <div className="w-full h-full thumb-skeleton" aria-hidden />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center rounded-[28px] border-2 border-dashed border-thumb-line bg-thumb-soft min-h-[280px] lg:min-h-[440px] px-8">
                <div className="w-14 h-14 rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center mb-4"><I.Image className="w-7 h-7" /></div>
                <h3 className="text-lg font-black">Your thumbnails will appear here</h3>
                <p className="text-sm text-thumb-sub mt-2 max-w-xs">Fill in the details on the left and hit <span className="font-bold text-thumb-ink">Generate</span> — your results show up right here.</p>
              </div>
            )}
          </div>
          </div>
        </section>
        )}

        {/* ── Feed preview tester (Preview section) ── */}
        {section === 'preview' && (
        <section className="pt-6 pb-16">
          <div className="grid lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] gap-6 lg:gap-8 items-start max-w-6xl mx-auto">
          {/* LEFT: controls */}
          <div className="thumb-glass thumb-float-red rounded-3xl p-5 sm:p-6 lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto no-scrollbar">
            <div className="grid gap-5">
              {/* Thumbnail */}
              <div className="min-w-0">
                <label className="text-sm font-bold text-thumb-ink mb-2 block">Thumbnail</label>
                {previewImage ? (
                  <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 group">
                    <img src={previewImage} alt="Your thumbnail" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button onClick={() => previewFileRef.current?.click()} className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-bold">Change</button>
                      <button onClick={() => setPreviewImage(null)} className="px-3 py-1.5 rounded-lg bg-thumb-red text-white text-xs font-bold">Remove</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => previewFileRef.current?.click()}
                    className="w-full aspect-video rounded-2xl border-2 border-dashed border-white/15 bg-black/20 hover:border-thumb-red hover:text-thumb-red text-thumb-sub flex flex-col items-center justify-center gap-2 transition-colors"
                  >
                    <I.Upload className="w-7 h-7" />
                    <span className="text-sm font-semibold">Upload a thumbnail</span>
                  </button>
                )}
                <input ref={previewFileRef} type="file" accept="image/*" className="hidden" onChange={handlePreviewUpload} />
                {/* Pick from generated */}
                {generatedImages.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub mb-1.5">{compareMode ? 'Pick A from generated' : 'Or pick a generated one'}</p>
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                      {generatedImages.slice(0, 8).map(g => (
                        <button key={g.id} onClick={() => setPreviewImage(g.url)} className={`shrink-0 w-20 aspect-video rounded-lg overflow-hidden border-2 transition-all ${previewImage === g.url ? 'border-thumb-red' : 'border-transparent hover:border-white/20'}`}>
                          <img src={g.url} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Thumbnail B (compare mode only) */}
              {compareMode && (
                <div className="min-w-0">
                  <label className="text-sm font-bold text-thumb-ink mb-2 flex items-center gap-1.5">
                    <span className="w-5 h-5 rounded-md bg-thumb-red text-white text-[11px] font-black flex items-center justify-center">B</span> Thumbnail B
                  </label>
                  {previewImageB ? (
                    <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 group">
                      <img src={previewImageB} alt="Thumbnail B" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/50 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button onClick={() => previewFileRefB.current?.click()} className="px-3 py-1.5 rounded-lg bg-white text-black text-xs font-bold">Change</button>
                        <button onClick={() => setPreviewImageB(null)} className="px-3 py-1.5 rounded-lg bg-thumb-red text-white text-xs font-bold">Remove</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => previewFileRefB.current?.click()}
                      className="w-full aspect-video rounded-2xl border-2 border-dashed border-white/15 bg-black/20 hover:border-thumb-red hover:text-thumb-red text-thumb-sub flex flex-col items-center justify-center gap-2 transition-colors"
                    >
                      <I.Upload className="w-7 h-7" />
                      <span className="text-sm font-semibold">Upload variant B</span>
                    </button>
                  )}
                  <input ref={previewFileRefB} type="file" accept="image/*" className="hidden" onChange={handlePreviewUploadB} />
                  {generatedImages.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub mb-1.5">Pick B from generated</p>
                      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                        {generatedImages.slice(0, 8).map(g => (
                          <button key={g.id} onClick={() => setPreviewImageB(g.url)} className={`shrink-0 w-20 aspect-video rounded-lg overflow-hidden border-2 transition-all ${previewImageB === g.url ? 'border-thumb-red' : 'border-transparent hover:border-white/20'}`}>
                            <img src={g.url} alt="" className="w-full h-full object-cover" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Title + channel */}
              <div className="flex flex-col gap-4 min-w-0">
                <div>
                  <label className="text-sm font-bold text-thumb-ink mb-2 block">Video title</label>
                  <textarea
                    value={previewTitle}
                    onChange={e => setPreviewTitle(e.target.value)}
                    rows={3}
                    maxLength={100}
                    placeholder="Type your video title…"
                    className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 outline-none text-[15px] placeholder-thumb-sub/60 focus:ring-2 focus:ring-thumb-red/40 resize-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-thumb-ink mb-2 block">Channel name</label>
                  <input
                    value={previewChannel}
                    onChange={e => setPreviewChannel(e.target.value)}
                    placeholder="Your Channel"
                    className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3 outline-none text-[15px] placeholder-thumb-sub/60 focus:ring-2 focus:ring-thumb-red/40"
                  />
                </div>
              </div>
            </div>

            {/* Toggles: device + theme */}
            <div className="mt-5 pt-5 border-t border-white/10 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub mr-1">Device</span>
                <div className="flex bg-black/25 border border-white/5 rounded-full p-1 gap-1">
                  {DEVICES.map(d => (
                    <button
                      key={d.id}
                      onClick={() => setPreviewDevice(d.id)}
                      className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all ${previewDevice === d.id ? 'thumb-nav-active text-thumb-red' : 'text-thumb-sub hover:text-thumb-ink'}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub mr-1">Theme</span>
                <div className="flex bg-black/25 border border-white/5 rounded-full p-1 gap-1">
                  <button onClick={() => setPreviewDark(true)} className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all ${previewDark ? 'thumb-nav-active text-thumb-red' : 'text-thumb-sub hover:text-thumb-ink'}`}>Dark</button>
                  <button onClick={() => setPreviewDark(false)} className={`px-3.5 py-1.5 rounded-full text-[12px] font-bold transition-all ${!previewDark ? 'thumb-nav-active text-thumb-red' : 'text-thumb-sub hover:text-thumb-ink'}`}>Light</button>
                </div>
              </div>
            </div>

            {/* A/B compare toggle */}
            <div className="mt-4">
              <button
                onClick={() => { setCompareMode(v => !v); setWinner(null); }}
                className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all ${compareMode ? 'thumb-btn text-white' : 'bg-thumb-soft border border-thumb-line text-thumb-ink hover:border-thumb-red/40'}`}
              >
                <I.Grid className="w-4 h-4" /> {compareMode ? 'A/B compare on' : 'Compare two (A/B test)'}
              </button>
              {compareMode && <p className="text-[12px] text-thumb-sub mt-2 leading-relaxed text-center">Add a second thumbnail above — both show side-by-side in the feed so you can pick the clickier one.</p>}
            </div>
          </div>

          {/* RIGHT: feed preview */}
          <div className="min-w-0">
            {compareMode ? (
              <div className={`mx-auto max-w-3xl px-5 sm:px-8 py-8 rounded-[32px] transition-all duration-300 ${previewDark ? 'bg-[#0f0f0f] shadow-[0_40px_90px_-50px_rgba(0,0,0,0.9)]' : 'bg-white shadow-[0_40px_90px_-50px_rgba(0,0,0,0.35)]'}`}>
                <div className={`flex items-center justify-between gap-2 mb-6 pb-3 border-b ${previewDark ? 'border-white/[0.08]' : 'border-black/[0.08]'}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-4 rounded-[4px] bg-[#ff0000] flex items-center justify-center"><svg viewBox="0 0 24 24" className="w-3 h-3 text-white" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>
                    <span className={`text-[15px] font-semibold tracking-[-0.02em] ${previewDark ? 'text-white' : 'text-[#0f0f0f]'}`}>YouTube</span>
                  </div>
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${previewDark ? 'text-zinc-500' : 'text-thumb-sub'}`}>A / B test</span>
                </div>

                {(previewImage || previewImageB) ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6">
                      {[{ key: 'A' as const, img: previewImage }, { key: 'B' as const, img: previewImageB }].map(v => (
                        <div key={v.key} className={`rounded-2xl p-2.5 transition-all ${winner === v.key ? 'ring-2 ring-thumb-red bg-thumb-red/[0.06]' : 'ring-1 ring-transparent'}`}>
                          <div className="relative aspect-video rounded-xl overflow-hidden bg-black/20">
                            {v.img ? (
                              <img src={v.img} alt={`Thumbnail ${v.key}`} className="w-full h-full object-cover" />
                            ) : (
                              <button onClick={() => (v.key === 'A' ? previewFileRef : previewFileRefB).current?.click()} className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-thumb-sub hover:text-thumb-red transition-colors">
                                <I.Upload className="w-6 h-6" /><span className="text-xs font-semibold">Add variant {v.key}</span>
                              </button>
                            )}
                            <span className="absolute top-1.5 left-1.5 w-6 h-6 rounded-md bg-black/80 text-white text-xs font-black flex items-center justify-center">{v.key}</span>
                            {winner === v.key && <span className="absolute top-1.5 right-1.5 bg-thumb-red text-white text-[10px] font-black uppercase tracking-wide px-2 py-0.5 rounded-full">Winner</span>}
                            {v.img && <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[11px] font-medium px-1 py-0.5 rounded leading-none">14:57</span>}
                          </div>
                          <div className="flex gap-3 mt-3">
                            <div className="w-9 h-9 rounded-full bg-thumb-red text-white flex items-center justify-center text-[13px] font-semibold shrink-0">{(previewChannel[0] || 'Y').toUpperCase()}</div>
                            <div className="min-w-0">
                              <p className={`font-medium text-sm leading-[1.35] line-clamp-2 ${previewDark ? 'text-[#f1f1f1]' : 'text-[#0f0f0f]'}`}>{previewTitle || 'Your video title goes here'}</p>
                              <p className={`text-[13px] mt-1 flex items-center gap-1 ${previewDark ? 'text-[#aaa]' : 'text-thumb-sub'}`}>{previewChannel || 'Your Channel'} <I.Check className="w-3 h-3 opacity-70" /></p>
                              <p className={`text-[13px] leading-tight ${previewDark ? 'text-[#aaa]' : 'text-thumb-sub'}`}>123K views · 1 hour ago</p>
                            </div>
                          </div>
                          <button
                            onClick={() => setWinner(v.key)}
                            disabled={!v.img}
                            className={`mt-3 w-full py-2.5 rounded-xl text-xs font-bold transition-colors disabled:opacity-40 ${winner === v.key ? 'thumb-btn text-white' : 'bg-thumb-soft border border-thumb-line text-thumb-ink hover:border-thumb-red/40'}`}
                          >
                            {winner === v.key ? '★ Your pick' : 'Pick this'}
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className={`text-center text-[13px] mt-6 ${previewDark ? 'text-zinc-500' : 'text-thumb-sub'}`}>
                      {winner ? <>You picked <span className="font-bold text-thumb-red">Thumbnail {winner}</span> — go with that one 🎯</> : 'Glance at both like a real viewer would — which one would you click first?'}
                    </p>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-16 px-8">
                    <div className="w-14 h-14 rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center mb-4"><I.Grid className="w-7 h-7" /></div>
                    <h3 className="text-lg font-black text-thumb-ink">Add two thumbnails to compare</h3>
                    <p className="text-sm text-thumb-sub mt-2 max-w-xs">Set Thumbnail A and Thumbnail B on the left — they'll show side-by-side here.</p>
                  </div>
                )}
              </div>
            ) : previewImage ? (
              <div className={`-mx-5 sm:mx-auto ${deviceConf.frame} px-5 sm:px-8 py-8 rounded-none sm:rounded-[32px] transition-all duration-300 ${previewDark ? 'bg-[#0f0f0f] sm:shadow-[0_40px_90px_-50px_rgba(0,0,0,0.9)]' : 'bg-white sm:shadow-[0_40px_90px_-50px_rgba(0,0,0,0.35)]'}`}>
                {/* Realistic YouTube top bar */}
                <div className={`flex items-center justify-between gap-2 mb-5 pb-3 border-b ${previewDark ? 'border-white/[0.08]' : 'border-black/[0.08]'}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="w-6 h-4 rounded-[4px] bg-[#ff0000] flex items-center justify-center"><svg viewBox="0 0 24 24" className="w-3 h-3 text-white" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>
                    <span className={`text-[15px] font-semibold tracking-[-0.02em] ${previewDark ? 'text-white' : 'text-[#0f0f0f]'}`}>YouTube</span>
                  </div>
                  <span className={`text-[11px] font-medium ${previewDark ? 'text-zinc-500' : 'text-thumb-sub'}`}>{DEVICES.find(d => d.id === previewDevice)?.label} · {previewDark ? 'Dark' : 'Light'}</span>
                </div>
                <div className={`grid ${deviceConf.cols} ${deviceConf.gap}`}>
                  {FEED_NEIGHBORS.map((n, i) => (
                    <React.Fragment key={i}>
                      {/* Your thumbnail sits in the MIDDLE of the feed — blends in like a real video, no highlight */}
                      {i === 2 && (
                        <div>
                          <div className="relative aspect-video rounded-xl overflow-hidden">
                            <img src={previewImage} alt="Your thumbnail" className="w-full h-full object-cover" />
                            <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[11px] font-medium px-1 py-0.5 rounded leading-none">14:57</span>
                          </div>
                          <div className="flex gap-3 mt-3">
                            <div className="w-9 h-9 rounded-full bg-thumb-red text-white flex items-center justify-center text-[13px] font-semibold shrink-0">{(previewChannel[0] || 'Y').toUpperCase()}</div>
                            <div className="min-w-0">
                              <p className={`font-medium text-sm leading-[1.35] line-clamp-2 ${previewDark ? 'text-[#f1f1f1]' : 'text-[#0f0f0f]'}`}>{previewTitle || 'Your video title goes here'}</p>
                              <p className={`text-[13px] mt-1 flex items-center gap-1 ${previewDark ? 'text-[#aaa]' : 'text-thumb-sub'}`}>{previewChannel || 'Your Channel'} <I.Check className="w-3 h-3 opacity-70" /></p>
                              <p className={`text-[13px] leading-tight ${previewDark ? 'text-[#aaa]' : 'text-thumb-sub'}`}>123K views · 1 hour ago</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <div className="relative aspect-video rounded-xl overflow-hidden">
                          {SHOWCASE_IMAGES[i] ? (
                            <img src={SHOWCASE_IMAGES[i]} alt="" loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            <div className={`w-full h-full bg-gradient-to-br ${n.hue} flex items-center justify-center`}><I.Youtube className="w-9 h-9 text-white/40" /></div>
                          )}
                          <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[11px] font-medium px-1 py-0.5 rounded leading-none">{n.dur}</span>
                        </div>
                        <div className="flex gap-3 mt-3">
                          <div className={`w-9 h-9 rounded-full ${n.av} text-white flex items-center justify-center text-base shrink-0`}>{n.logo}</div>
                          <div className="min-w-0">
                            <p className={`font-medium text-sm leading-[1.35] line-clamp-2 ${previewDark ? 'text-[#f1f1f1]' : 'text-[#0f0f0f]'}`}>{n.title}</p>
                            <p className={`text-[13px] mt-1 ${previewDark ? 'text-[#aaa]' : 'text-thumb-sub'}`}>{n.channel}</p>
                            <p className={`text-[13px] leading-tight ${previewDark ? 'text-[#aaa]' : 'text-thumb-sub'}`}>{n.meta}</p>
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center rounded-[28px] border-2 border-dashed border-thumb-line bg-thumb-soft min-h-[440px] px-8">
                <div className="w-14 h-14 rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center mb-4"><I.Tv className="w-7 h-7" /></div>
                <h3 className="text-lg font-black">Preview your thumbnail in the feed</h3>
                <p className="text-sm text-thumb-sub mt-2 max-w-xs">Upload a thumbnail on the left (or pick a generated one) to see how it looks next to real videos.</p>
                <button onClick={goGenerate} className="thumb-btn mt-5 px-5 py-2.5 rounded-xl text-white font-bold text-sm inline-flex items-center gap-2"><I.Wand className="w-4 h-4" /> Generate one</button>
              </div>
            )}
          </div>
          </div>
        </section>
        )}

        {/* ── Pricing ── */}
        {section === 'pricing' && (
          <Suspense fallback={<PanelFallback />}>
            <Pricing onCheckout={startCheckout} onBuyAddon={buyAddon} onRequireLogin={() => requireLogin('Log in to upgrade.')} />
          </Suspense>
        )}

        {/* ── Title Generator tool ── */}
        {section === 'title' && (
          <div className="animate-fade-in-up pt-10 sm:pt-12 pb-16">
            <Suspense fallback={<PanelFallback />}><TitleGenerator /></Suspense>
          </div>
        )}

        {/* ── YouTube Chapter Maker tool ── */}
        {section === 'chapters' && (
          <div className="animate-fade-in-up pt-10 sm:pt-12 pb-16">
            <Suspense fallback={<PanelFallback />}><ChapterMaker /></Suspense>
          </div>
        )}

        {/* ── Account / profile ── */}
        {section === 'account' && (
          <Suspense fallback={<PanelFallback />}>
            <Account onUpgrade={goPricing} onLogin={() => requireLogin('Log in to see your account.')} />
          </Suspense>
        )}

        {/* ── Admin: global styles (server re-checks is_admin on every call) ── */}
        {section === 'admin' && profile?.is_admin && (
          <Suspense fallback={<PanelFallback />}>
            <AdminStyles />
          </Suspense>
        )}

        {/* ── Showcase gallery (real thumbnails) — home only ── */}
        {section === 'home' && (SHOWCASE_IMAGES.length > 0 ? (
          <section className="pt-16">
            <p className="text-center text-[13px] font-bold uppercase tracking-[0.15em] text-thumb-sub mb-6">Thumbnails people actually clicked</p>
            <div className="relative -mx-5 overflow-hidden">
              {/* Rows live in their own space-y-4 wrapper — the fade divs below
                  are siblings OUTSIDE it on purpose. space-y-4 puts margin-top
                  on every non-first child of whatever div it's on, and the fades
                  used to be direct children of the same div as the rows, so they
                  silently got a 16px margin-top pushed onto them too: inset-y-0
                  still set top:0, but margin-top shifted the rendered box down
                  16px, leaving a hard, unfaded strip along the very top of the
                  row instead of a smooth edge. */}
              <div className="space-y-4">
                <div className="flex gap-4 w-max thumb-marquee">
                  {[...SHOWCASE_ROW_1, ...SHOWCASE_ROW_1].map((src, i) => (
                    <div key={i} className="w-[260px] lg:w-[340px] aspect-video rounded-2xl overflow-hidden border border-thumb-line thumb-card bg-thumb-soft shrink-0">
                      {/* Eager, not lazy: these cards scroll into view purely via CSS
                          transform (not real page scroll), which native lazy-loading's
                          intersection check doesn't reliably re-run for — some images
                          would sit half-loaded (a pale placeholder patch) as they
                          drifted across the row. There are only a handful of small
                          showcase images, so loading them all upfront is cheap. */}
                      <img src={src} alt="" decoding="async" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
                {/* Second row scrolls the opposite way AND draws from the other half
                    of SHOWCASE_IMAGES (see SHOWCASE_ROW_2 above) — distinct photos,
                    not just a reordering of row one's, so nothing repeats between rows. */}
                <div className="flex gap-4 w-max thumb-marquee-reverse">
                  {[...SHOWCASE_ROW_2.slice().reverse(), ...SHOWCASE_ROW_2.slice().reverse()].map((src, i) => (
                    <div key={i} className="w-[260px] lg:w-[340px] aspect-video rounded-2xl overflow-hidden border border-thumb-line thumb-card bg-thumb-soft shrink-0">
                      <img src={src} alt="" decoding="async" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
              {/* Edge fades — softens the hard clip where the row is cut off.
                  Narrower on mobile (was hidden there entirely, which lost
                  the effect completely) so it still softens the edge without
                  covering a big chunk of each small card. */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-10 sm:w-28 bg-gradient-to-r from-thumb-bg to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-10 sm:w-28 bg-gradient-to-l from-thumb-bg to-transparent" />
            </div>

            {/* Capability stats */}
            <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
              {[
                { n: '~30s', accent: '', l: 'Avg. generation time' },
                { n: '10', accent: '+', l: 'Viral style templates' },
                { n: '4K', accent: '', l: '16:9 export quality' },
                { n: '$0.30', accent: '', l: 'Starting per thumbnail' },
              ].map(s => (
                <div key={s.l} className="thumb-glass rounded-2xl px-4 py-6 text-center">
                  <p className="text-3xl sm:text-4xl font-black text-thumb-ink tracking-tight">{s.n}<span className="text-thumb-red">{s.accent}</span></p>
                  <p className="text-xs sm:text-sm text-thumb-sub mt-1.5 font-medium">{s.l}</p>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="pt-14">
            <div className="max-w-3xl mx-auto rounded-2xl border border-dashed border-thumb-line bg-thumb-soft px-6 py-8 text-center">
              <p className="text-sm font-semibold text-thumb-ink">Showcase gallery</p>
              <p className="text-xs text-thumb-sub mt-1.5 leading-relaxed">Drop real 16:9 thumbnails into <code className="bg-thumb-card border border-thumb-line rounded px-1.5 py-0.5 text-thumb-red">attached_assets/showcase/</code> and they appear here automatically.</p>
            </div>
          </section>
        ))}

        {/* ── Marketing (home only) ── */}
        {section === 'home' && (
        <>
        {/* ── Real Results (YouTube-Studio style before/after) ── */}
        <section className="pt-16 pb-20">
          <div className="text-center">
            <p className="text-thumb-red font-black tracking-widest text-sm uppercase">Never miss clicks</p>
            <h2 className="text-3xl sm:text-4xl font-black mt-3 max-w-2xl mx-auto leading-tight">Turn your views into real results</h2>
            <p className="text-thumb-sub mt-3 max-w-xl mx-auto">More impressions, more clicks, more views &amp; more revenue — see what a high-converting thumbnail actually does.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-5 mt-10 max-w-4xl mx-auto px-1">
            {/* BEFORE — underperforming */}
            <div className="thumb-glass rounded-3xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-thumb-red bg-thumb-redSoft border border-thumb-red/30 rounded-full px-2.5 py-1">
                  <I.ArrowDown className="w-3.5 h-3.5" /> Before
                </span>
                <span className="text-[11px] font-semibold text-thumb-sub">First 3 days 21 hours</span>
              </div>
              <div className="rounded-2xl bg-black/25 border border-white/5 p-4">
                <p className="text-sm font-bold text-thumb-ink mb-3">Video performance</p>
                {[
                  { l: 'Ranking by views', v: '10 of 10' },
                  { l: 'Views', v: '2.2K', down: true },
                  { l: 'Impressions click-through rate', v: '2.7%', down: true },
                  { l: 'Average view duration', v: '4:27', down: true },
                ].map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-t border-white/5 first:border-0">
                    <span className="text-[13px] text-thumb-sub">{r.l}</span>
                    <span className="flex items-center gap-1.5 text-[13px] font-bold text-thumb-ink">
                      {r.v}
                      {r.down && <span className="w-4 h-4 rounded-full bg-zinc-600/60 text-white flex items-center justify-center"><I.ArrowDown className="w-2.5 h-2.5" /></span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* AFTER — winning */}
            <div className="thumb-glass thumb-float-green rounded-3xl p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-thumb-green bg-thumb-greenSoft border border-thumb-green/30 rounded-full px-2.5 py-1">
                  <I.ArrowUp className="w-3.5 h-3.5" /> After PodcastFlux
                </span>
                <span className="text-[11px] font-semibold text-thumb-sub">Since published</span>
              </div>
              <div className="rounded-2xl bg-black/25 border border-white/5 p-4">
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-[13px] text-thumb-sub">Views</p>
                    <p className="text-3xl font-black text-thumb-ink leading-none mt-0.5">1.3M</p>
                    <p className="text-[12px] font-bold text-thumb-green mt-1">585.7K more than usual</p>
                  </div>
                  <span className="text-thumb-green"><I.ArrowUp className="w-6 h-6" /></span>
                </div>
                {[
                  { l: 'Ranking by views', v: '1 of 10' },
                  { l: 'Impressions click-through rate', v: '11.7%', up: true },
                  { l: 'Average view duration', v: '6:27', up: true },
                  { l: 'Estimated revenue', v: '+312%', up: true },
                ].map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-t border-white/5">
                    <span className="text-[13px] text-thumb-sub">{r.l}</span>
                    <span className="flex items-center gap-1.5 text-[13px] font-bold text-thumb-ink">
                      {r.v}
                      {r.up && <span className="w-4 h-4 rounded-full bg-thumb-green text-black flex items-center justify-center"><I.ArrowUp className="w-2.5 h-2.5" /></span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="text-center mt-8">
            <h3 className="text-xl sm:text-2xl font-black">Turn underperformers into winners</h3>
            <p className="text-thumb-sub mt-2 max-w-lg mx-auto">Never let another video flatline. Create, test, iterate &amp; unlock more views.</p>
            <button onClick={goGenerate} className="thumb-btn mt-5 px-6 py-3 rounded-full text-white font-bold inline-flex items-center gap-2">
              <I.Wand className="w-4 h-4" /> Create better thumbnails
            </button>
          </div>
        </section>

        {/* ── Testimonials ── */}
        <section className="pb-6">
          <p className="text-center text-thumb-green font-black tracking-widest text-xs uppercase">Loved by creators</p>
          <h2 className="text-center text-3xl sm:text-4xl font-black mt-3 mb-10">What creators are saying</h2>
          <div className="grid sm:grid-cols-3 gap-6 max-w-5xl mx-auto px-1">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="thumb-glass thumb-float-green rounded-3xl p-6 flex flex-col">
                {/* red stars + green verified */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex gap-0.5 text-thumb-red">{[0,1,2,3,4].map(k => <I.Star key={k} className="w-4 h-4" />)}</div>
                  <span className="flex items-center gap-1 text-[11px] font-bold text-thumb-green bg-thumb-greenSoft border border-thumb-green/25 rounded-full px-2 py-0.5">
                    <I.Check className="w-3.5 h-3.5" /> Verified
                  </span>
                </div>
                <h3 className="font-black text-lg leading-snug mb-2">{t.title}</h3>
                <p className="text-sm text-thumb-sub leading-relaxed mb-5 flex-1">{t.body}</p>
                <div className="flex items-center gap-3 pt-4 border-t border-white/10">
                  <img
                    src={t.avatar}
                    alt={t.name}
                    loading="lazy"
                    className="w-11 h-11 rounded-full object-cover ring-2 ring-thumb-green/40 shrink-0"
                  />
                  <div>
                    <div className="font-bold text-sm">{t.name}</div>
                    <div className="text-xs text-thumb-sub">{t.loc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="py-16 max-w-3xl mx-auto">
          <p className="text-center text-thumb-green font-black tracking-widest text-xs uppercase">Got questions?</p>
          <h2 className="text-center text-3xl sm:text-4xl font-black mt-3 mb-10">Frequently asked questions</h2>
          <div className="space-y-4">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <div key={i} className={`thumb-glass rounded-2xl overflow-hidden transition-all duration-300 ${open ? 'thumb-float-red' : ''}`}>
                  <h3 className="m-0">
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      aria-controls={`faq-answer-${i}`}
                      className="w-full flex items-center gap-4 text-left px-4 sm:px-5 py-4"
                    >
                      <span className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center transition-all duration-300 ${open ? 'thumb-btn text-white' : 'bg-white/5 border border-white/10 text-thumb-ink'}`}>
                        <span className={`transition-transform duration-300 ${open ? 'rotate-45' : ''} text-xl leading-none font-light`}>+</span>
                      </span>
                      <span className={`font-bold text-[15px] sm:text-base transition-colors duration-200 ${open ? 'text-thumb-red' : 'text-thumb-ink'}`}>{f.q}</span>
                    </button>
                  </h3>
                  {/* max-height (not grid-template-rows) — animates reliably on iOS Safari,
                      which doesn't smoothly interpolate fr-unit grid track sizes. */}
                  <div id={`faq-answer-${i}`} className={`overflow-hidden transition-[max-height] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? 'max-h-[400px]' : 'max-h-0'}`}>
                    <p className="px-4 sm:px-5 pb-5 sm:pl-[4.25rem] text-sm text-thumb-sub leading-relaxed">{f.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className="border-t border-thumb-line mt-8 pt-10 pb-12">
          <div className="max-w-6xl mx-auto px-1 flex flex-col md:flex-row md:items-start md:justify-between gap-8">
            <div className="max-w-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="thumb-btn w-8 h-8 rounded-xl flex items-center justify-center text-white"><I.Wand className="w-4 h-4" /></div>
                <span className="text-lg font-extrabold tracking-tight text-thumb-ink">PodcastFlux</span>
              </div>
              <p className="text-sm text-thumb-sub leading-relaxed">The best free AI thumbnail maker for YouTube — turn a prompt, photo, or YouTube video link into high-quality, click-worthy HD thumbnails, titles &amp; timestamps in seconds.</p>
            </div>
            <div className="flex flex-wrap gap-x-12 gap-y-6">
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-thumb-sub mb-3">Product</p>
                <ul className="space-y-2 text-sm">
                  <li><button onClick={goHome} className="text-thumb-ink hover:text-thumb-red transition-colors">Home</button></li>
                  <li><button onClick={() => setSection('pricing')} className="text-thumb-ink hover:text-thumb-red transition-colors">Pricing</button></li>
                  <li><button onClick={() => setSection('generate')} className="text-thumb-ink hover:text-thumb-red transition-colors">AI Thumbnail Maker</button></li>
                  <li><button onClick={goTitle} className="text-thumb-ink hover:text-thumb-red transition-colors">YouTube Title Generator</button></li>
                  <li><button onClick={goChapters} className="text-thumb-ink hover:text-thumb-red transition-colors">YouTube Timestamps Maker</button></li>
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-wider text-thumb-sub mb-3">Company</p>
                <ul className="space-y-2 text-sm">
                  <li><button onClick={() => setLegal('about')} className="text-thumb-ink hover:text-thumb-red transition-colors">About</button></li>
                  <li><button onClick={() => setLegal('privacy')} className="text-thumb-ink hover:text-thumb-red transition-colors">Privacy Policy</button></li>
                  <li><button onClick={() => setLegal('terms')} className="text-thumb-ink hover:text-thumb-red transition-colors">Terms of Service</button></li>
                  <li><a href="mailto:support@rmind.com" className="text-thumb-ink hover:text-thumb-red transition-colors">Contact</a></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="max-w-6xl mx-auto px-1 mt-10 pt-6 border-t border-thumb-line flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-thumb-sub">© {new Date().getFullYear()} PodcastFlux. All rights reserved.</p>
            <p className="text-xs text-thumb-sub">Made for creators who want more clicks.</p>
          </div>
        </footer>
        </>
        )}
      </main>

      {/* ── Legal / About modal ── */}
      {legal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setLegal(null)} />
          <div className="relative thumb-glass rounded-3xl w-full max-w-2xl max-h-[85vh] overflow-y-auto no-scrollbar p-6 sm:p-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-black text-thumb-ink">
                {legal === 'about' ? 'About PodcastFlux' : legal === 'privacy' ? 'Privacy Policy' : 'Terms of Service'}
              </h2>
              <button onClick={() => setLegal(null)} className="w-9 h-9 rounded-xl bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center transition-colors">✕</button>
            </div>
            <div className="space-y-4 text-sm text-thumb-sub leading-relaxed">
              {legal === 'about' && (
                <>
                  <p>PodcastFlux is a free AI thumbnail maker built for YouTube creators. Describe your idea, upload a photo, or paste a YouTube video link, and our AI designs high-quality, high-converting HD 16:9 thumbnails in seconds — no Photoshop, Adobe Express, or design skills required.</p>
                  <p>Our goal is simple: help creators get more clicks with less effort. We combine state-of-the-art AI image models with creator-tested templates so every result is upload-ready — plus a free AI title generator and YouTube timestamps maker to round out your upload.</p>
                  <p>Questions or feedback? Email us at <a href="mailto:support@rmind.com" className="text-thumb-red font-semibold">support@rmind.com</a>.</p>
                </>
              )}
              {legal === 'privacy' && (
                <>
                  <p>Last updated: {new Date().getFullYear()}. This Privacy Policy explains how PodcastFlux ("we", "us") handles your information.</p>
                  <p><strong className="text-thumb-ink">Information we collect.</strong> When you sign in with Google, we receive your name, email address, and profile image to create your account. We store the thumbnails you generate and basic usage data (such as credit balance) to run the service.</p>
                  <p><strong className="text-thumb-ink">How we use it.</strong> To provide the thumbnail-generation service, manage your plan and credits, and improve the product. We do not sell your personal data.</p>
                  <p><strong className="text-thumb-ink">Storage & processing.</strong> Data is stored with our infrastructure providers (including Supabase and cloud AI providers) solely to operate the service. Images you upload as references are used only to produce your requested results.</p>
                  <p><strong className="text-thumb-ink">Your choices.</strong> You can delete generated thumbnails at any time, and you may request account deletion by emailing <a href="mailto:support@rmind.com" className="text-thumb-red font-semibold">support@rmind.com</a>.</p>
                  <p><strong className="text-thumb-ink">Contact.</strong> For any privacy question, reach us at support@rmind.com.</p>
                </>
              )}
              {legal === 'terms' && (
                <>
                  <p>Last updated: {new Date().getFullYear()}. By using PodcastFlux you agree to these Terms of Service.</p>
                  <p><strong className="text-thumb-ink">Use of the service.</strong> PodcastFlux provides AI-generated thumbnails. You are responsible for the prompts and images you submit, and for ensuring you have the rights to any photos you upload.</p>
                  <p><strong className="text-thumb-ink">Credits & plans.</strong> Generating thumbnails consumes credits included with paid plans. Add-on credit packs are one-time purchases and do not expire. A generation that fails does not consume a credit.</p>
                  <p><strong className="text-thumb-ink">Acceptable use.</strong> Do not use the service to create illegal, infringing, hateful, or deceptive content, or to abuse the API. We may suspend accounts that violate these terms.</p>
                  <p><strong className="text-thumb-ink">Content ownership.</strong> You own the thumbnails you generate and may use them on your channels. The service is provided "as is" without warranties.</p>
                  <p><strong className="text-thumb-ink">Contact.</strong> Questions? Email support@rmind.com.</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Auth (Google-only) modal ── */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} reason={authReason} />

      {/* ── Change face on an existing generated thumbnail ── */}
      {changeFaceTarget && (
        <ChangeFaceModal
          targetUrl={changeFaceTarget}
          onClose={() => setChangeFaceTarget(null)}
          onSubmit={applyChangeFace}
          loggedIn={!configured || !!user}
          onRequireLogin={() => requireLogin('Log in to change faces.')}
          personaRefreshKey={personaRefreshKey}
        />
      )}

      {/* ── Persona / Style popups shared by Sketch and YouTube Advanced ── */}
      <PersonaPicker
        enabled
        loggedIn={!configured || !!user}
        onRequireLogin={() => requireLogin('Log in to use saved faces.')}
        refreshKey={personaRefreshKey}
        onPick={pickPersona}
        externalOpen={personaModalOpen}
        onExternalClose={() => setPersonaModalOpen(false)}
      />
      <StylePickerModal
        open={styleModalOpen === 'sketch'}
        onClose={() => setStyleModalOpen(null)}
        styleImages={styleImages}
        selected={selectedSketchStyle}
        onSelect={setSelectedSketchStyle}
        hint="Match this style's look — the sketch still decides the layout."
      />
      <StylePickerModal
        open={styleModalOpen === 'youtube'}
        onClose={() => setStyleModalOpen(null)}
        styleImages={styleImages}
        selected={selectedYtStyle}
        onSelect={setSelectedYtStyle}
        hint="Leave unpicked to auto-match the best style for this video."
      />
    </div>
  );
};

export default ThumbnailStudio;
