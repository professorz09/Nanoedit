
export interface EditorSettings {
  aspectRatio: string;
  resolution: '1K' | '2K' | '4K'; // 1K is default/Flash. 2K/4K triggers Pro.
  modelType: 'flash' | 'pro';
  style: string;
  cameraAngle: string;
  // Set for YouTube-mode generations — the server charges a higher, fixed
  // credit cost for these (covers the transcript/concept/style-match calls
  // that only that pipeline does). Undefined/omitted = the normal 1-credit price.
  sourceMode?: 'youtube';
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  timestamp: number;
  aspect?: string; // '16:9' (thumbnail) or '9:16' (Shorts) — drives result display
}

export interface QueueItem {
  id: string;
  prompt: string;
  settings: EditorSettings;
  sourceImages: string[];
  status: 'pending' | 'processing' | 'failed';
  timestamp: number;
  error?: string;
}

export interface GenerationState {
  isLoading: boolean;
  error: string | null;
}

export const ASPECT_RATIOS = [
  { label: '1:1', value: '1:1', icon: 'Square' },
  { label: '3:4', value: '3:4', icon: 'Portrait' },
  { label: '4:3', value: '4:3', icon: 'Landscape' },
  { label: '9:16', value: '9:16', icon: 'Mobile' },
  { label: '16:9', value: '16:9', icon: 'Wide' },
];

export const RESOLUTIONS = [
  { label: 'Standard', value: '1K', desc: 'Fast (Flash)' },
  { label: 'HD', value: '2K', desc: 'High Quality (Pro)' },
  { label: 'UHD', value: '4K', desc: 'Max Quality (Pro)' },
];

export const STYLES = [
  { label: 'None', value: 'None' },
  { label: 'Cinematic', value: 'Cinematic' },
  { label: 'Anime', value: 'Anime' },
  { label: 'Digital Art', value: 'Digital Art' },
  { label: 'Pixel Art', value: 'Pixel Art' },
  { label: 'Oil Painting', value: 'Oil Painting' },
  { label: 'Photorealistic', value: 'Photorealistic' },
  { label: 'Vintage', value: 'Vintage' },
  { label: 'Cyberpunk', value: 'Cyberpunk' },
  { label: 'Watercolor', value: 'Watercolor' },
  { label: '3D Render', value: '3D Render' },
  { label: 'Handwritten Notes', value: 'Handwritten Notes' },
  { label: 'Black Background', value: 'Black Background' },
  { label: 'White Background', value: 'White Background' },
  { label: 'Minimalist', value: 'Minimalist' },
  { label: 'Sketch', value: 'Sketch' },
  { label: 'Neon Glow', value: 'Neon Glow' },
];

// One-click quick actions tuned for what a thumbnail creator needs instantly.
export const PRESET_PROMPTS = [
  {
    label: 'Cutout Subject',
    icon: '✂️',
    prompt: 'Create a professional cutout of the main subject with a fully transparent background. Remove every background element while preserving the subject with perfect, clean edges. Output as PNG with transparency.',
  },
  {
    label: 'Pop Colors',
    icon: '🎨',
    prompt: 'Make this thumbnail pop: dramatically boost color saturation, vibrance and contrast for a punchy, high-energy YouTube look. Add bright rim lighting and crisp highlights while keeping the subject natural and sharp.',
  },
  {
    label: 'Face Focus',
    icon: '😲',
    prompt: "Sharpen and enhance the person's face and expression so it becomes the clear focal point. Improve skin detail, eyes and facial clarity, brighten the face slightly and add subtle dramatic lighting, keeping it realistic.",
  },
  {
    label: 'Cinematic Light',
    icon: '💡',
    prompt: 'Add cinematic, dramatic studio lighting to the subject: strong rim light, moody depth, glowing accents and rich contrast for a premium thumbnail feel. Keep the subject and composition unchanged.',
  },
  {
    label: 'Enhance',
    icon: '✨',
    prompt: 'Enhance this image: improve quality, sharpness, color balance and overall visual appeal while preserving the original content and composition.',
  },
  {
    label: 'Upscale HD',
    icon: '🔍',
    prompt: 'Upscale this image to higher resolution while maintaining sharpness and adding fine detail. Keep the original style and content intact.',
  },
];

// ── Thumbnail Studio ──────────────────────────────────────────────
// Input mode drives which composer the studio uses.
export type ThumbInputMode = 'youtube' | 'templates' | 'prompt' | 'reference' | 'sketch';

export interface ThumbnailTemplate {
  id: string;
  label: string;
  emoji: string;
  // Tailwind gradient classes used for the preview swatch
  swatch: string;
  // Short description shown under the label
  desc: string;
  // Style directive injected into the generation prompt. {TEXT} is replaced
  // with the creator's title text (or removed when empty).
  style: string;
}

export const THUMBNAIL_TEMPLATES: ThumbnailTemplate[] = [
  {
    id: 'mrbeast',
    label: 'MrBeast Hype',
    emoji: '🤯',
    swatch: 'from-red-500 to-orange-500',
    desc: 'Shocked face, ultra-bright, high energy',
    style: 'Explosive high-energy MrBeast style: a person with an exaggerated shocked/excited facial expression, hyper-saturated punchy colors, bright rim lighting, glowing accents and money/fire/explosion energy in the background, extreme contrast.',
  },
  {
    id: 'mystery',
    label: 'Dark Mystery',
    emoji: '🕵️',
    swatch: 'from-zinc-800 to-zinc-950',
    desc: 'Moody, cinematic, "secret inside" vibe',
    style: 'Dark cinematic mystery style: moody low-key lighting, deep shadows, a single dramatic light source on the subject, teal-and-orange cinematic grade, suspenseful atmosphere.',
  },
  {
    id: 'transformation',
    label: 'Transformation',
    emoji: '🔥',
    swatch: 'from-emerald-500 to-cyan-500',
    desc: 'Before/after glow-up energy',
    style: 'Bold transformation / glow-up style: dynamic split or radiant composition, aspirational bright lighting, confident subject, motivational energy, crisp and clean.',
  },
  {
    id: 'finance',
    label: 'Money & Growth',
    emoji: '📈',
    swatch: 'from-lime-500 to-emerald-600',
    desc: 'Charts, arrows, green growth',
    style: 'Finance / business growth style: upward green arrows and chart graphics, clean infographic elements, professional confident subject, wealth and success cues, sharp readable data visuals.',
  },
  {
    id: 'adventure',
    label: 'Epic Adventure',
    emoji: '🏔️',
    swatch: 'from-blue-500 to-indigo-600',
    desc: 'Big landscapes, wow factor',
    style: 'Epic adventure / travel style: breathtaking wide landscape, dramatic natural lighting, sense of scale and awe, vivid HDR outdoor colors, adventurous subject.',
  },
  {
    id: 'gaming',
    label: 'Gaming',
    emoji: '🎮',
    swatch: 'from-fuchsia-500 to-purple-600',
    desc: 'Neon, energetic, game art',
    style: 'High-energy gaming style: vibrant neon glow, dynamic action composition, stylized game-art background, RGB lighting, intense and playful mood.',
  },
  {
    id: 'podcast',
    label: 'Podcast / Talk',
    emoji: '🎙️',
    swatch: 'from-amber-500 to-rose-500',
    desc: 'Clean portrait + bold quote',
    style: 'Clean podcast / interview style: well-lit confident portrait, simple bold background, professional studio look, space reserved for a strong quote or title.',
  },
  {
    id: 'tutorial',
    label: 'Tutorial / How-To',
    emoji: '💡',
    swatch: 'from-sky-500 to-blue-600',
    desc: 'Clear, friendly, informative',
    style: 'Friendly tutorial / how-to style: clear bright lighting, approachable subject, simple uncluttered background, helpful iconography, trustworthy and readable.',
  },
  {
    id: 'transform-split',
    label: 'Before / After',
    emoji: '🔀',
    swatch: 'from-sky-500 to-pink-500',
    desc: 'Split before/after glow-up',
    style: 'Split before-and-after transformation style: the same subject shown twice side by side with a bold white arrow between them, contrasting colored backgrounds (cool blue on the left, vivid pink/magenta on the right), hand-held DAY 1 vs DAY N signs, dramatic glow-up, ultra-bright punchy studio lighting.',
  },
  {
    id: 'wild-survival',
    label: 'Wild Survival',
    emoji: '🦁',
    swatch: 'from-amber-500 to-orange-700',
    desc: 'Man vs wild animal, intense',
    style: 'High-stakes wild survival style: a person with an intense strained expression up close against a huge dangerous wild animal in a sunlit savanna, torn dirty clothes, sweat and scratches, dramatic natural lighting, extreme tension and adventure.',
  },
  {
    id: 'jungle-danger',
    label: 'Jungle Danger',
    emoji: '🐍',
    swatch: 'from-emerald-600 to-green-900',
    desc: 'Muddy, wet, up-close peril',
    style: 'Gritty jungle survival style: a muddy soaked subject waist-deep in dark jungle water gripping a machete, a huge snake or creature lunging at the camera with its mouth open, wide shocked eyes, wet dramatic lighting, lush green backdrop, visceral danger.',
  },
  {
    id: 'expose-split',
    label: 'Exposé Compare',
    emoji: '⚖️',
    swatch: 'from-zinc-200 to-slate-400',
    desc: 'Split object + big price arrows',
    style: 'Investigative exposé comparison style: a single object split down the middle showing a good half versus a ruined half, clean graph-paper background, huge bold black headline, contrasting price/number labels (one black, one red) with curved hand-drawn arrows pointing at each side, clickbait "this is a problem" energy.',
  },
  {
    id: 'character-render',
    label: 'Character Render',
    emoji: '🦸',
    swatch: 'from-red-600 to-rose-800',
    desc: 'Bold cinematic character/cosplay',
    style: 'Hyper-detailed character showcase style: a striking cinematic hero/cosplay character posed against a bold solid textured color background (deep red), glossy costume detail, dramatic rim lighting, high-contrast 3D-render look, larger-than-life comic-book presence.',
  },
  {
    id: 'animated-expose',
    label: 'Animated Story',
    emoji: '💸',
    swatch: 'from-fuchsia-600 to-red-600',
    desc: 'Cartoon + big red word button',
    style: 'Stylized animated story-explainer style: a cartoon/3D character with exaggerated features (glowing dollar-sign eyes) on the left, dark glitchy data-overlay background, a big glossy red rounded button holding one huge bold white word on the right, mouse-cursor accent, dramatic true-crime storytime mood.',
  },
];

export const CAMERA_ANGLES = [
  { label: 'None', value: 'None' },
  { label: 'Eye Level', value: 'Eye Level' },
  { label: 'Low Angle', value: 'Low Angle' },
  { label: 'High Angle', value: 'High Angle' },
  { label: 'Overhead', value: 'Overhead' },
  { label: 'Drone View', value: 'Drone View' },
  { label: 'Macro', value: 'Macro' },
  { label: 'Wide Angle', value: 'Wide Angle' },
  { label: 'Dutch Angle', value: 'Dutch Angle' },
];

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
  }
}