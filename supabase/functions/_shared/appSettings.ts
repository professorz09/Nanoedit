// ═══════════════════════════════════════════════════════════════════════════
// Admin settings (public.app_settings, migration 0023; edited in Admin → ⚙️ Settings): which image model
// and which provider the image / text calls use. Plain TypeScript with no runtime imports, so the same
// file serves the Supabase functions (Deno) and the Node API (api/*.ts on our server / Vercel).
//
// A provider is 'google' (Google Cloud / Vertex only), 'openrouter' (OpenRouter only) or 'fallback'
// (Google Cloud first, then OpenRouter). The ChatGPT image model only runs on OpenRouter.
// ═══════════════════════════════════════════════════════════════════════════

export type Provider = 'google' | 'openrouter' | 'fallback';

export type AppSettings = {
  imageModel: 'gemini' | 'gpt';
  imageProvider: Provider;
  textProvider: Provider;
  gptImageModel: string;               // '' → the caller's own default
  geminiOpenRouterImageModel: string;  // '' → google/<the Gemini model id>
  shortsPerUser: number;
  shortsTotal: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  imageModel: 'gemini',
  imageProvider: 'fallback',
  textProvider: 'fallback',
  gptImageModel: '',
  geminiOpenRouterImageModel: '',
  shortsPerUser: 2,
  shortsTotal: 2,
};

const provider = (v: unknown): Provider | null =>
  v === 'google' || v === 'openrouter' || v === 'fallback' ? v : null;
const modelId = (v: unknown): string => (typeof v === 'string' && /^[\w.\-/:]{1,120}$/.test(v.trim()) ? v.trim() : '');
const count = (v: unknown, fallback: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : fallback;
};

export function parseSettings(data: any): AppSettings {
  const d = data && typeof data === 'object' ? data : {};
  return {
    imageModel: d.image_model === 'gpt' ? 'gpt' : 'gemini',
    imageProvider: provider(d.image_provider) ?? DEFAULT_SETTINGS.imageProvider,
    textProvider: provider(d.text_provider) ?? DEFAULT_SETTINGS.textProvider,
    gptImageModel: modelId(d.gpt_image_model),
    geminiOpenRouterImageModel: modelId(d.gemini_openrouter_image_model),
    shortsPerUser: count(d.shorts_per_user, DEFAULT_SETTINGS.shortsPerUser),
    shortsTotal: count(d.shorts_total, DEFAULT_SETTINGS.shortsTotal),
  };
}

// a settings change reaches every warm instance within this long
const TTL_MS = 30_000;
let cached: { at: number; value: AppSettings } | null = null;

/** The admin settings, read with a service-role client. Never throws: the last good read (or the defaults). */
export async function loadAppSettings(admin: any): Promise<AppSettings> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const { data, error } = await admin.from('app_settings').select('data').eq('id', 'global').maybeSingle();
    if (error) throw error;
    cached = { at: Date.now(), value: parseSettings(data?.data) };
  } catch (e: any) {
    console.error('app_settings_read_failed', e?.message || String(e));
    if (!cached) return DEFAULT_SETTINGS;
    cached = { ...cached, at: Date.now() - TTL_MS + 5_000 }; // try again in a few seconds
  }
  return cached.value;
}

/** The backends to try, in order, for a provider setting. */
export const providerSteps = (p: Provider): Array<'google' | 'openrouter'> =>
  p === 'google' ? ['google'] : p === 'openrouter' ? ['openrouter'] : ['google', 'openrouter'];
