import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GeneratedImage, QueueItem, ThumbInputMode, THUMBNAIL_TEMPLATES } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabase';
import { Plan, BillingCycle, priceFor } from '../services/plans';
import AuthModal from './AuthModal';
import Pricing from './Pricing';
import Account from './Account';

// Auto-load any real thumbnails dropped into attached_assets/showcase/ (16:9 jpg/png/webp).
// No code changes needed — just add image files and they appear in the showcase gallery.
const SHOWCASE_IMAGES = Object.entries(
  import.meta.glob('../attached_assets/showcase/*.{png,jpg,jpeg,webp,PNG,JPG,JPEG,WEBP}', {
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
  Moon: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>),
  Sun: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>),
  ArrowUp: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 19V5M5 12l7-7 7 7" /></svg>),
  ArrowDown: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 5v14M19 12l-7 7-7-7" /></svg>),
  Tv: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="2" y="7" width="20" height="13" rx="2" /><path d="m17 2-5 5-5-5" /></svg>),
  Check: (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z" /></svg>),
  Play: (p: any) => (<svg viewBox="0 0 24 24" fill="currentColor" {...p}><path d="M8 5v14l11-7z" /></svg>),
  Bolt2: (p: any) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>),
};

// ── Prompt composition ────────────────────────────────────────────
const BASE_THUMB = 'Design a professional, scroll-stopping YouTube thumbnail in 16:9 landscape. Ultra sharp, high dynamic range, dramatic studio lighting, punchy saturated colors, and strong contrast so it stands out even at small sizes. One clear focal point, rule-of-thirds composition, clean depth. No watermarks or logos.';

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
    return 'Only add on-image text if it genuinely strengthens the design, and if so keep it to a punchy 1-2 word hook in white.';
  }
  const long = raw.split(/\s+/).length > 5;
  const hook = long
    ? `distill the idea into a punchy 2-4 word hook (do NOT paste the whole sentence)`
    : `use it exactly as "${raw}"`;
  return `Overlay bold, chunky, EXTRA-LARGE uppercase title text — ${hook}. The text color MUST be pure white with a thick solid black outline and a strong drop shadow for maximum contrast. Place it clear of the subject's face and keep it to at most one third of the frame.`;
};

// Extract the 11-char YouTube video id from most URL shapes
export const extractYouTubeId = (url: string): string | null => {
  const m = url.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
};

// Convert a bundled asset URL (template preview) into a base64 data-URL so it can
// be sent to the model as a real style reference.
const urlToBase64 = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
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
  onRetry: (item: QueueItem) => void;
  onCancel: (id: string) => void;
}

const TABS: { id: ThumbInputMode; label: string; icon: (p: any) => React.ReactElement }[] = [
  { id: 'youtube', label: 'YouTube Link', icon: I.Youtube },
  { id: 'templates', label: 'Templates', icon: I.Grid },
  { id: 'prompt', label: 'Prompt', icon: I.Text },
  { id: 'reference', label: 'Reference', icon: I.Image },
];

const TESTIMONIALS = [
  { name: 'Rico Griek', loc: 'Netherlands', avatar: 'https://randomuser.me/api/portraits/men/32.jpg', title: 'Thumbnails that finally match my vision', body: 'It was always hard to make thumbnails that fit what I pictured. Now I paste a link, pick a style, and get click-worthy results in seconds.' },
  { name: 'Sidharth Das', loc: 'United States', avatar: 'https://randomuser.me/api/portraits/men/75.jpg', title: 'A time & money saver for a small YouTuber', body: 'A total godsend. I\'ve used it for a month now and the results are super impressive — it saves me the whole design headache.' },
  { name: 'Dan Kieft', loc: 'United Kingdom', avatar: 'https://randomuser.me/api/portraits/men/18.jpg', title: 'Great for thumbnail ideation', body: 'Even when I want to design myself, it gives me strong directions fast. My CTR is noticeably up since I started.' },
];

const FAQS = [
  { q: 'Do I need design skills to use it?', a: 'No. Everything works through simple prompts, templates, and text-based edits. You describe what you want and the AI handles the design and execution.' },
  { q: 'Can I use it with my own face?', a: 'Yes. Upload your photo in Reference or Templates mode and the AI keeps your likeness while building a fresh, high-converting thumbnail around it.' },
  { q: 'How does the YouTube link option work?', a: 'Paste any video link and we pull its current thumbnail as a reference, then generate improved, more click-worthy versions that keep the same theme.' },
  { q: 'What size are the thumbnails?', a: 'Full 16:9 HD, ready to upload straight to YouTube. Every result downloads at high resolution with no watermark.' },
  { q: 'Can I edit a thumbnail after generating?', a: 'Yes. Send any result to the built-in Nano Edit editor to tweak text, swap backgrounds, brush-select areas, remove background, and more.' },
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
}) => {
  const [mode, setMode] = useState<ThumbInputMode>('youtube');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [titleText, setTitleText] = useState('');
  const [promptText, setPromptText] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<string>(THUMBNAIL_TEMPLATES[0].id);
  const [uploads, setUploads] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Lock background scroll while the sidebar (mobile drawer) is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    if (sidebarOpen) document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [sidebarOpen]);
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  // Landing ('home') vs generator ('generate') vs feed preview ('preview') vs pricing
  const [section, setSection] = useState<'home' | 'generate' | 'preview' | 'pricing' | 'account'>('home');

  // Auth + billing
  const { user, profile, totalCredits, signOut, configured } = useAuth();
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

  // Stripe checkout — asks the backend for a Checkout URL and redirects.
  const startCheckout = async (plan: Plan, cycle: BillingCycle) => {
    if (!user || !supabase) { requireLogin('Log in to upgrade.'); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ plan: plan.id, cycle, priceEnv: priceFor(plan, cycle).priceEnv }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.url) window.location.href = data.url;
      else setNote('Checkout is not available yet. Please try again shortly.');
    } catch {
      setNote('Could not start checkout. Please try again.');
    }
  };

  const buyAddon = async (addonId: string) => {
    if (!user || !supabase) { requireLogin('Log in to buy credits.'); return; }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ addon: addonId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.url) window.location.href = data.url;
      else setNote('Checkout is not available yet. Please try again shortly.');
    } catch {
      setNote('Could not start checkout. Please try again.');
    }
  };

  // YouTube feed preview
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');
  const [previewDark, setPreviewDark] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewChannel, setPreviewChannel] = useState('Your Channel');
  const previewFileRef = useRef<HTMLInputElement>(null);

  const handlePreviewUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const r = new FileReader();
      r.onload = ev => { if (ev.target?.result) setPreviewImage(ev.target.result as string); };
      r.readAsDataURL(file);
    }
    e.target.value = '';
  };
  // Send a thumbnail into the full-page feed tester (single preview system — no modal)
  const openPreview = (url: string) => {
    setPreviewImage(url);
    setPreviewTitle(prev => prev || titleText || 'This changed everything (I was shocked)');
    setSection('preview');
    setSidebarOpen(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 60);
  };

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
    setMode('prompt');
    setNote(null);
    setSection('generate');
    if (configured && !user) { requireLogin('Log in to generate your thumbnail.'); return; }
    if (configured && user && totalCredits <= 0) { goPricing(); return; }
    if (promptText.trim()) {
      const prompt = `${promptText.trim()}. ${textDirective(titleText)} ${BASE_THUMB}`;
      onGenerate(prompt, [...uploads]);
      scrollToResults();
    } else {
      setTimeout(() => document.getElementById('thumb-tool')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  };

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
    // Gate behind auth + credits once Supabase is configured (dev without keys stays open).
    if (configured) {
      if (!user) { requireLogin('Log in to generate your thumbnail.'); return; }
      if (totalCredits <= 0) { goPricing(); return; }
    }
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
        prompt = `Using the uploaded YouTube thumbnail as reference for the subject and topic, create a fresh, more click-worthy version that keeps the same theme but is far more eye-catching. ${topicDirective(titleText)}${textDirective(titleText)} ${BASE_THUMB}`;
      } else {
        setNote('Could not fetch that video\'s thumbnail (private/unavailable). Generating from your title instead — add a title below for best results.');
        if (!titleText.trim()) { return; }
        prompt = `Create a viral YouTube thumbnail about "${titleText.trim()}". ${topicDirective(titleText)}${textDirective(titleText)} ${BASE_THUMB}`;
      }
    } else if (mode === 'templates') {
      const tpl = THUMBNAIL_TEMPLATES.find(t => t.id === selectedTemplate)!;
      const topic = titleText.trim();
      const hasFace = uploads.length > 0;
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
    } else if (mode === 'prompt') {
      prompt = `${promptText.trim()}. ${topicDirective(promptText || titleText)}${textDirective(titleText)} ${BASE_THUMB}`;
    } else {
      // reference
      const extra = promptText.trim() ? `Additional direction: ${promptText.trim()}. ` : '';
      prompt = `Using the uploaded reference image(s) as strong inspiration for style, mood and composition, create a brand-new original thumbnail (do not copy it exactly). ${uploads.length ? 'If a person appears, preserve their likeness. ' : ''}${extra}${topicDirective(promptText || titleText)}${textDirective(titleText)} ${BASE_THUMB}`;
    }

    onGenerate(prompt, sources);
    scrollToResults();
  }, [canGenerate, mode, uploads, youtubeUrl, titleText, promptText, selectedTemplate, onGenerate, configured, user, totalCredits]);

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
            <button onClick={goHome} className="flex items-center gap-2.5">
              <div className="thumb-btn w-10 h-10 rounded-[13px] flex items-center justify-center text-white">
                <I.Wand className="w-5 h-5" />
              </div>
              <span className="text-xl font-extrabold tracking-tight">Thumbmagic</span>
            </button>
            {/* Desktop nav */}
            <nav className="hidden lg:flex items-center gap-1">
              {[
                { label: 'Generate', on: goGenerate, active: section === 'generate' && mode !== 'templates' },
                { label: 'Templates', on: () => goToMode('templates'), active: section === 'generate' && mode === 'templates' },
                { label: 'Feed test', on: goPreview, active: section === 'preview' },
                { label: 'Pricing', on: goPricing, active: section === 'pricing' },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.on}
                  className={`px-3.5 py-2 rounded-xl text-sm font-bold transition-colors ${item.active ? 'text-thumb-red bg-thumb-redSoft' : 'text-thumb-sub hover:text-thumb-ink hover:bg-thumb-soft'}`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2.5 sm:gap-3">
            {configured && user ? (
              <>
                <button onClick={goPricing} title="Credits — tap to top up" className="flex items-center gap-1.5 bg-thumb-soft border border-thumb-line rounded-full pl-2.5 pr-3 py-1.5 text-sm font-bold text-thumb-ink hover:border-thumb-red/40 transition-colors">
                  <I.Bolt className="w-4 h-4 text-thumb-red" /> {totalCredits}
                  <span className="hidden sm:inline text-thumb-sub font-semibold">credits</span>
                </button>
                <button onClick={goAccount} className="w-9 h-9 rounded-full bg-thumb-red text-white flex items-center justify-center text-sm font-black shrink-0 hover:ring-2 hover:ring-thumb-red/40 transition-all" title={user.email ?? undefined} aria-label="Account">
                  {(user.email?.[0] || 'U').toUpperCase()}
                </button>
              </>
            ) : (
              <>
                {configured && (
                  <button onClick={() => requireLogin()} className="text-sm font-bold text-thumb-ink hover:text-thumb-red transition-colors px-2">
                    Log in
                  </button>
                )}
                <button onClick={goGenerate} className="thumb-btn text-white font-bold text-sm px-5 py-2.5 rounded-full">
                  Start now
                </button>
              </>
            )}
            <button onClick={() => setSidebarOpen(true)} className="p-2 text-thumb-ink/70 hover:text-thumb-ink" aria-label="Menu"><I.Menu className="w-6 h-6" /></button>
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
              <span className="font-extrabold tracking-tight">Thumbmagic</span>
            </div>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 text-thumb-sub hover:text-thumb-ink" aria-label="Close menu"><I.X className="w-5 h-5" /></button>
          </div>

          {/* Theme switch */}
          <div className="px-3 pt-3 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-black/25 border border-white/[0.06] rounded-2xl">
              <button
                onClick={() => setTheme('dark')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[13px] font-bold transition-all ${theme === 'dark' ? 'thumb-nav-active text-thumb-red' : 'text-thumb-sub hover:text-thumb-ink'}`}
              >
                <I.Moon className="w-4 h-4" /> Dark
              </button>
              <button
                onClick={() => setTheme('light')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-[13px] font-bold transition-all ${theme === 'light' ? 'thumb-nav-active text-thumb-red' : 'text-thumb-sub hover:text-thumb-ink'}`}
              >
                <I.Sun className="w-4 h-4" /> Light
              </button>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-2">
            <p className="px-2 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Menu</p>
            {([
              { key: 'home', label: 'Home', tag: 'Landing', icon: I.Wand, active: section === 'home', onClick: goHome },
              { key: 'generate', label: 'Generate', tag: 'Create', icon: I.Bolt, active: section === 'generate' && mode !== 'templates', onClick: goGenerate },
              { key: 'preview', label: 'Preview', tag: 'Feed test', icon: I.Tv, active: section === 'preview', onClick: goPreview },
              { key: 'editor', label: 'Nano Editor', tag: 'Canvas', icon: I.Edit, active: false, onClick: () => { setSidebarOpen(false); onOpenEditor(); } },
              { key: 'templates', label: 'Templates', tag: 'Styles', icon: I.Grid, active: section === 'generate' && mode === 'templates', onClick: () => goToMode('templates') },
              { key: 'pricing', label: 'Pricing', tag: 'Plans', icon: I.Star, active: section === 'pricing', onClick: goPricing },
              { key: 'account', label: 'Account', tag: 'Profile', icon: I.Check, active: section === 'account', onClick: goAccount },
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
                  <div className="w-9 h-9 rounded-full bg-thumb-red text-white flex items-center justify-center text-sm font-black shrink-0">{(user.email?.[0] || 'U').toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-thumb-ink truncate">{user.email}</p>
                    <p className="text-[11px] text-thumb-sub">{totalCredits} credits · {profile?.plan ?? 'free'}</p>
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
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 rounded-full bg-thumb-redSoft border border-thumb-red/20 pl-2 pr-3.5 py-1.5 text-[13px] font-bold text-thumb-red">
            <span className="w-5 h-5 rounded-full bg-thumb-red text-white flex items-center justify-center"><I.Bolt className="w-3 h-3" /></span>
            AI YouTube thumbnails
          </div>

          <h1 className="mt-6 text-[2.9rem] sm:text-[4.5rem] lg:text-[5.5rem] font-black leading-[0.95] tracking-[-0.04em] text-thumb-ink max-w-4xl mx-auto">
            Viral thumbnails, <span className="text-thumb-red">in seconds</span>
          </h1>
          <p className="mt-5 text-lg sm:text-xl text-thumb-sub max-w-2xl mx-auto leading-relaxed">
            From ignored to clicked. Describe your video and get scroll-stopping, click-worthy thumbnails — no design skills needed.
          </p>

          {/* One clean prompt box — click sends you into the generator and starts */}
          <div className="mt-10 max-w-3xl mx-auto text-left">
            <div className="thumb-glass thumb-float-red rounded-[28px] p-3.5 sm:p-4">
              <textarea
                value={promptText}
                onChange={e => setPromptText(e.target.value)}
                onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') startFromHome(); }}
                rows={3}
                placeholder="Describe your video — e.g. How history's dumbest man accidentally became the richest"
                className="w-full bg-transparent px-3 pt-3 pb-3 outline-none text-[16px] sm:text-[17px] placeholder-thumb-sub/60 resize-none"
              />
              <div className="flex flex-col sm:flex-row gap-2.5 sm:items-center">
                <button
                  onClick={startFromHome}
                  className="thumb-btn flex-1 py-4 rounded-2xl text-white font-black text-lg flex items-center justify-center gap-3"
                >
                  <I.Wand className="w-5 h-5" /> Generate My First Thumbnail
                </button>
                <button
                  onClick={goGenerate}
                  className="shrink-0 py-4 px-5 rounded-2xl font-bold text-sm text-thumb-ink bg-thumb-soft border border-thumb-line hover:border-thumb-red/40 transition-colors flex items-center justify-center gap-2"
                >
                  <I.Youtube className="w-4 h-4 text-thumb-red" /> YouTube link &amp; more
                </button>
              </div>
            </div>
            {/* Trust row */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-thumb-sub">
              <span className="inline-flex items-center gap-1.5"><I.Check className="w-4 h-4 text-thumb-green" /> 5 free thumbnails</span>
              <span className="inline-flex items-center gap-1.5"><I.Check className="w-4 h-4 text-thumb-green" /> No credit card</span>
              <span className="inline-flex items-center gap-1.5"><I.Check className="w-4 h-4 text-thumb-green" /> 4K · 16:9 exports</span>
            </div>
          </div>
        </section>
        )}

        {/* ── Generator tool (Generate section) ── */}
        {section === 'generate' && (
        <section id="thumb-tool" className="scroll-mt-24 pt-10">
          <div className="thumb-glass thumb-float-red rounded-[28px] p-5 sm:p-8 max-w-3xl mx-auto">
            {/* Card header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="thumb-btn w-11 h-11 rounded-2xl flex items-center justify-center text-white shrink-0"><I.Wand className="w-5 h-5" /></div>
              <div className="leading-tight">
                <h2 className="text-lg font-black tracking-tight">AI Thumbnail Generator</h2>
              </div>
            </div>

            {/* Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 bg-black/30 border border-white/[0.06] rounded-2xl">
              {TABS.map(t => {
                const active = mode === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setMode(t.id); setNote(null); }}
                    className={`flex items-center justify-center gap-2 py-2.5 px-2 rounded-xl text-[13px] font-bold transition-all ${
                      active ? 'thumb-nav-active text-thumb-red' : 'text-thumb-sub hover:text-thumb-ink hover:bg-white/5'
                    }`}
                  >
                    <t.icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Panels */}
            <div className="mt-6 space-y-5">
              {mode === 'youtube' && (
                <div className="space-y-2.5 animate-fade-in-up">
                  <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">YouTube video link</label>
                  <div className="flex items-center gap-3 bg-black/30 border border-white/10 rounded-2xl px-4 transition-all focus-within:border-thumb-red/50 focus-within:ring-4 focus-within:ring-thumb-red/10">
                    <I.Youtube className="w-5 h-5 text-thumb-red shrink-0" />
                    <input
                      value={youtubeUrl}
                      onChange={e => setYoutubeUrl(e.target.value)}
                      placeholder="youtu.be/gO0bvT_smdM"
                      className="w-full bg-transparent py-4 outline-none text-[15px] placeholder-thumb-sub/50"
                    />
                  </div>
                </div>
              )}

              {mode === 'templates' && (
                <div className="space-y-3 animate-fade-in-up">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-thumb-ink">Pick a style</label>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub bg-thumb-soft border border-thumb-line rounded-full px-2.5 py-1">{THUMBNAIL_TEMPLATES.length} styles</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-[440px] overflow-y-auto no-scrollbar pr-0.5 -mr-0.5">
                    {THUMBNAIL_TEMPLATES.map(tpl => {
                      const active = selectedTemplate === tpl.id;
                      const preview = TEMPLATE_PREVIEWS[tpl.id] || SHOWCASE_TEMPLATE_PREVIEWS[tpl.id];
                      return (
                        <button
                          key={tpl.id}
                          onClick={() => setSelectedTemplate(tpl.id)}
                          className={`relative rounded-2xl overflow-hidden border-2 text-left transition-all ${
                            active ? 'border-thumb-red shadow-md' : 'border-transparent hover:border-thumb-line'
                          }`}
                          title={tpl.desc}
                        >
                          {preview ? (
                            <div className="aspect-video overflow-hidden bg-black/40">
                              <img src={preview} alt={tpl.label} loading="lazy" className="w-full h-full object-cover" />
                            </div>
                          ) : (
                            <div className={`aspect-video bg-gradient-to-br ${tpl.swatch} flex items-center justify-center text-2xl`}>{tpl.emoji}</div>
                          )}
                          <div className="px-2.5 py-2 bg-thumb-card">
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
                <div className="space-y-2.5 animate-fade-in-up">
                  <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Describe your thumbnail</label>
                  <textarea
                    value={promptText}
                    onChange={e => setPromptText(e.target.value)}
                    rows={3}
                    placeholder="e.g. A shocked gamer with glowing headset, explosion behind, neon RGB lighting..."
                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-4 outline-none text-[15px] placeholder-thumb-sub/50 transition-all focus:border-thumb-red/50 focus:ring-4 focus:ring-thumb-red/10 resize-none"
                  />
                </div>
              )}

              {mode === 'reference' && (
                <div className="space-y-2.5 animate-fade-in-up">
                  <label className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Upload reference or your photo</label>
                  <div
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); readFiles(Array.from(e.dataTransfer.files)); }}
                    className="border-2 border-dashed border-white/12 rounded-2xl p-7 flex flex-col items-center justify-center gap-2.5 text-thumb-sub hover:border-thumb-red hover:text-thumb-red cursor-pointer transition-all bg-black/20"
                  >
                    <div className="w-11 h-11 rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center"><I.Upload className="w-5 h-5" /></div>
                    <span className="text-sm font-bold">Click or drag to upload</span>
                    <span className="text-xs text-thumb-sub/80">Up to 4 images · PNG or JPG</span>
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
                  <textarea
                    value={promptText}
                    onChange={e => setPromptText(e.target.value)}
                    rows={2}
                    placeholder="Optional: extra direction (colors, mood, subject...)"
                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-3.5 outline-none text-sm placeholder-thumb-sub/50 transition-all focus:border-thumb-red/50 focus:ring-4 focus:ring-thumb-red/10 resize-none"
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
                <div className="space-y-2.5">
                  <label className="flex items-center justify-between">
                    <span className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">{mode === 'templates' ? 'Video topic / title' : 'Title text on thumbnail'}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${mode === 'templates' ? 'text-thumb-red bg-thumb-redSoft border border-thumb-red/25' : 'text-thumb-sub bg-white/5 border border-white/10'}`}>{mode === 'templates' ? 'required' : 'optional'}</span>
                  </label>
                  <input
                    value={titleText}
                    onChange={e => setTitleText(e.target.value)}
                    placeholder="e.g. THIS CHANGED EVERYTHING"
                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-4 outline-none text-[15px] placeholder-thumb-sub/50 transition-all focus:border-thumb-red/50 focus:ring-4 focus:ring-thumb-red/10"
                  />
                </div>
              )}
              {mode === 'prompt' && (
                <div className="space-y-2.5">
                  <label className="flex items-center justify-between">
                    <span className="text-[13px] font-bold uppercase tracking-wider text-thumb-sub">Title text on thumbnail</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-thumb-sub bg-white/5 border border-white/10">optional</span>
                  </label>
                  <input
                    value={titleText}
                    onChange={e => setTitleText(e.target.value)}
                    placeholder="e.g. THIS CHANGED EVERYTHING"
                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-4 outline-none text-[15px] placeholder-thumb-sub/50 transition-all focus:border-thumb-red/50 focus:ring-4 focus:ring-thumb-red/10"
                  />
                </div>
              )}

              {note && (
                <div className="text-xs bg-thumb-redSoft text-red-300 border border-thumb-red/20 rounded-xl px-4 py-3 leading-relaxed">{note}</div>
              )}

              {/* Generate */}
              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="thumb-btn w-full py-4 rounded-2xl text-white font-black text-lg flex items-center justify-center gap-3 disabled:text-white/70 mt-1"
              >
                {busy ? (
                  <><span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Fetching…</>
                ) : (
                  <><I.Wand className="w-5 h-5" /> Generate Thumbnails</>
                )}
              </button>
            </div>
          </div>
        </section>
        )}

        {/* ── Feed preview tester (Preview section) ── */}
        {section === 'preview' && (
        <section className="pt-6 pb-16">
          <button
            onClick={goGenerate}
            className="group inline-flex items-center gap-1.5 text-sm font-bold text-thumb-sub hover:text-thumb-ink bg-thumb-soft border border-thumb-line rounded-full pl-2 pr-3.5 py-1.5 transition-colors mb-6"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Back to generate
          </button>
          <div className="text-center mb-8">
            <h1 className="text-3xl sm:text-5xl font-black tracking-[-0.03em]">Test your thumbnail</h1>
            <p className="text-thumb-sub mt-3 max-w-xl mx-auto">See exactly how your thumbnail &amp; title compete in the YouTube feed — on desktop, tablet and mobile.</p>
          </div>

          {/* Controls */}
          <div className="thumb-glass thumb-float-red rounded-3xl p-5 sm:p-6 max-w-3xl mx-auto overflow-hidden">
            <div className="grid sm:grid-cols-2 gap-5">
              {/* Thumbnail */}
              <div className="min-w-0">
                <label className="text-sm font-bold text-thumb-ink mb-2 block">Thumbnail</label>
                {previewImage ? (
                  <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10 group">
                    <img src={previewImage} alt="Your thumbnail" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
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
                    <p className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub mb-1.5">Or pick a generated one</p>
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
          </div>

          {/* Feed preview */}
          <div className={`mt-10 -mx-5 sm:mx-0 px-5 sm:px-8 py-8 sm:rounded-[32px] transition-colors duration-300 ${previewImage ? (previewDark ? 'bg-[#0f0f0f] sm:shadow-[0_40px_90px_-50px_rgba(0,0,0,0.9)]' : 'bg-white sm:shadow-[0_40px_90px_-50px_rgba(0,0,0,0.35)]') : ''}`}>
            {previewImage ? (
              <div className={`mx-auto ${deviceConf.frame} transition-all duration-300`}>
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
              <div className="max-w-md mx-auto text-center rounded-2xl border border-dashed border-thumb-line bg-thumb-soft/60 px-6 py-12">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-thumb-redSoft text-thumb-red flex items-center justify-center mb-4"><I.Tv className="w-6 h-6" /></div>
                <p className="font-bold text-thumb-ink">Upload a thumbnail to preview</p>
                <p className="text-sm text-thumb-sub mt-1.5">Drop in your thumbnail above (or pick a generated one) to see how it looks in the feed.</p>
                <button onClick={goGenerate} className="thumb-btn mt-5 px-5 py-2.5 rounded-xl text-white font-bold text-sm inline-flex items-center gap-2"><I.Wand className="w-4 h-4" /> Generate one</button>
              </div>
            )}
          </div>
        </section>
        )}

        {/* ── Pricing ── */}
        {section === 'pricing' && (
          <Pricing onCheckout={startCheckout} onBuyAddon={buyAddon} onRequireLogin={() => requireLogin('Log in to upgrade.')} />
        )}

        {/* ── Account / profile ── */}
        {section === 'account' && (
          <Account onUpgrade={goPricing} onLogin={() => requireLogin('Log in to see your account.')} />
        )}

        {/* ── Showcase gallery (real thumbnails) — home only ── */}
        {section === 'home' && (SHOWCASE_IMAGES.length > 0 ? (
          <section className="pt-16">
            <p className="text-center text-[13px] font-bold uppercase tracking-[0.15em] text-thumb-sub mb-6">Thumbnails people actually clicked</p>
            <div className="relative -mx-5 overflow-hidden">
              <div className="flex gap-4 w-max thumb-marquee">
                {[...SHOWCASE_IMAGES, ...SHOWCASE_IMAGES].map((src, i) => (
                  <div key={i} className="w-[260px] lg:w-[340px] aspect-video rounded-2xl overflow-hidden border border-thumb-line thumb-card shrink-0">
                    <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
              {/* edge fades */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-16 sm:w-28 bg-gradient-to-r from-thumb-bg to-transparent" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-16 sm:w-28 bg-gradient-to-l from-thumb-bg to-transparent" />
            </div>

            {/* Capability stats */}
            <div className="mt-14 grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
              {[
                { n: '~12s', accent: '', l: 'Avg. generation time' },
                { n: '10', accent: '+', l: 'Viral style templates' },
                { n: '4K', accent: '', l: '16:9 export quality' },
                { n: '5', accent: ' free', l: 'Thumbnails to start' },
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

        {/* ── Results (Generate section) ── */}
        {section === 'generate' && (
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

                {generatedImages.map(img => (
                  <div key={img.id} className="group relative rounded-2xl overflow-hidden border border-thumb-line bg-thumb-card shadow-sm animate-fade-in-up flex flex-col">
                    <div className="relative aspect-video overflow-hidden">
                      <img src={img.url} alt={img.prompt} loading="lazy" className="w-full h-full object-cover cursor-pointer" onClick={() => onView(img.url)} />
                    </div>
                    {/* Clean action bar (always visible, works on touch) — single delete */}
                    <div className="flex gap-1.5 p-2 bg-thumb-card">
                      <button onClick={() => onDownload(img.url)} title="Download" className="flex-1 py-2 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-ink text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-thumb-line/60 transition-colors"><I.Download className="w-4 h-4" /> Save</button>
                      <button onClick={() => onOpenEditor(img.url)} title="Edit in Canvas (Nano Editor)" className="flex-1 py-2 rounded-lg thumb-btn text-white text-xs font-bold flex items-center justify-center gap-1.5"><I.Edit className="w-4 h-4" /> Edit</button>
                      <button onClick={() => openPreview(img.url)} title="YouTube feed preview" className="w-9 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center transition-colors"><I.Tv className="w-4 h-4" /></button>
                      <button onClick={() => onDelete(img.id)} title="Delete" className="w-9 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-red hover:border-thumb-red/40 flex items-center justify-center transition-colors"><I.Trash className="w-4 h-4" /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
        )}

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
                  <I.ArrowUp className="w-3.5 h-3.5" /> After Thumbmagic
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
            <button onClick={goGenerate} className="thumb-btn mt-5 px-6 py-3 rounded-xl text-white font-bold inline-flex items-center gap-2">
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
                  <button onClick={() => setOpenFaq(open ? null : i)} className="w-full flex items-center gap-4 text-left px-4 sm:px-5 py-4">
                    <span className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center transition-all duration-300 ${open ? 'thumb-btn text-white' : 'bg-white/5 border border-white/10 text-thumb-ink'}`}>
                      <span className={`transition-transform duration-300 ${open ? 'rotate-45' : ''} text-xl leading-none font-light`}>+</span>
                    </span>
                    <span className={`font-bold text-[15px] sm:text-base transition-colors duration-200 ${open ? 'text-thumb-red' : 'text-thumb-ink'}`}>{f.q}</span>
                  </button>
                  <div className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <p className="px-4 sm:px-5 pb-5 sm:pl-[4.25rem] text-sm text-thumb-sub leading-relaxed">{f.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        </>
        )}
      </main>

      {/* ── Auth (Google-only) modal ── */}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} reason={authReason} />

      {/* ── YouTube feed preview modal ── */}
    </div>
  );
};

export default ThumbnailStudio;
