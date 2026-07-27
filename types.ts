
export interface EditorSettings {
  aspectRatio: string;
  resolution: '1K' | '2K' | '4K'; // 1K is default/Flash. 2K/4K triggers Pro.
  modelType: 'flash' | 'pro';
  style: string;
  cameraAngle: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  timestamp: number;
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

export const PRESET_PROMPTS = [
  {
    label: 'Study Notes',
    icon: '📝',
    prompt: 'Create a handwritten-style study note. Use a messy but readable student-style handwriting on lined notebook paper. Highlight all key terms with a yellow neon marker and circle any dates or numbers in red. Add small, simple doodles or sketches to explain concepts visually. Make sure the entire layout fits on a single A4-size printable page with good spacing, clear sections, and a neat heading. Include arrows, boxes, and mini callouts wherever helpful to improve memory recall.',
  },
  {
    label: 'White BG',
    icon: '⬜',
    prompt: 'Change the background of this image to pure white (#FFFFFF). Keep the main subject completely unchanged with clean, natural edges. Preserve all details, colors, and lighting of the subject.',
  },
  {
    label: 'Black BG',
    icon: '⬛',
    prompt: 'Change the background of this image to pure black (#000000). Keep the main subject completely unchanged with clean, natural edges. Preserve all details, colors, and lighting of the subject.',
  },
  {
    label: 'Transparent BG',
    icon: '🔲',
    prompt: 'Create a professional cutout of the main subject from this image with transparent background. Remove all background elements completely while preserving the subject with perfect edge quality. Output as PNG format with transparency.',
  },
  {
    label: 'Enhance',
    icon: '✨',
    prompt: 'Enhance this image: Improve quality, sharpness, color balance, and overall visual appeal while preserving the original content and composition.',
  },
  {
    label: 'Upscale',
    icon: '🔍',
    prompt: 'Upscale this image to higher resolution while maintaining sharpness and adding fine details. Keep the original style and content intact.',
  },
];

// ── Thumbnail Studio ──────────────────────────────────────────────
// Input mode drives which composer the studio uses.
export type ThumbInputMode = 'youtube' | 'templates' | 'prompt' | 'reference';

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