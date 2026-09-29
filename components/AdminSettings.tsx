import React, { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

// Admin → ⚙️ Settings: public.app_settings (migration 0023), read and written straight from here — its
// RLS lets only an admin (profiles.is_admin) do either. The thumbnail/text API, the Supabase functions
// (supabase/functions/_shared/appSettings.ts) and the Shorts server (Movievideomaker's shortsbot/web.py)
// read the same row, so a change reaches them within about 30 seconds.

type Provider = 'google' | 'openrouter' | 'fallback';

interface SettingsData {
  image_model: 'gemini' | 'gpt';
  image_provider: Provider;
  text_provider: Provider;
  gpt_image_model: string;
  gemini_openrouter_image_model: string;
  shorts_per_user: number;
  shorts_total: number;
}

const DEFAULTS: SettingsData = {
  image_model: 'gemini',
  image_provider: 'fallback',
  text_provider: 'fallback',
  gpt_image_model: '',
  gemini_openrouter_image_model: '',
  shorts_per_user: 2,
  shorts_total: 2,
};

const PROVIDERS: Array<{ id: Provider; label: string; hint: string }> = [
  { id: 'google', label: 'Google Cloud', hint: 'Vertex AI only' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'OpenRouter only' },
  { id: 'fallback', label: 'Fallback', hint: 'Google Cloud first, then OpenRouter' },
];

const clampCount = (v: unknown, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : fallback;
};

const Choice: React.FC<{ active: boolean; disabled?: boolean; onClick: () => void; label: string; hint?: string }> = ({ active, disabled, onClick, label, hint }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`text-left rounded-2xl border px-4 py-3 transition-colors ${active ? 'border-thumb-red bg-thumb-red/10' : 'border-thumb-line bg-thumb-soft hover:border-thumb-red/40'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
  >
    <div className="text-sm font-bold">{label}</div>
    {hint && <div className="text-[11px] text-thumb-sub mt-0.5">{hint}</div>}
  </button>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub mb-2">{children}</div>
);

const AdminSettings: React.FC = () => {
  const [data, setData] = useState<SettingsData>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data: row, error } = await supabase.from('app_settings').select('data').eq('id', 'global').maybeSingle();
      if (!alive) return;
      if (error) setNote({ ok: false, text: 'Could not load the settings.' });
      else setData({ ...DEFAULTS, ...(row?.data || {}) });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const set = <K extends keyof SettingsData>(key: K, value: SettingsData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
    setNote(null);
  };

  const save = async () => {
    if (!supabase) return;
    setSaving(true);
    setNote(null);
    const clean: SettingsData = {
      ...data,
      gpt_image_model: data.gpt_image_model.trim(),
      gemini_openrouter_image_model: data.gemini_openrouter_image_model.trim(),
      shorts_per_user: clampCount(data.shorts_per_user, DEFAULTS.shorts_per_user),
      shorts_total: clampCount(data.shorts_total, DEFAULTS.shorts_total),
    };
    const { data: rows, error } = await supabase.from('app_settings')
      .update({ data: clean, updated_at: new Date().toISOString() })
      .eq('id', 'global')
      .select('id');
    setSaving(false);
    if (error || !rows?.length) { setNote({ ok: false, text: 'Could not save — are you still signed in as an admin?' }); return; }
    setData(clean);
    setNote({ ok: true, text: 'Saved. It takes effect within about 30 seconds.' });
  };

  if (loading) return <section className="pt-6 max-w-5xl mx-auto text-sm text-thumb-sub">Loading settings…</section>;

  const gpt = data.image_model === 'gpt';

  return (
    <section className="pt-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-black tracking-tight">Admin — Settings</h1>
      <p className="text-sm text-thumb-sub mt-1.5">
        Which AI runs the thumbnails, text and Shorts, and how many Shorts render at once.
      </p>

      <div className="thumb-glass rounded-3xl p-5 sm:p-6 mt-6 space-y-6">
        <h2 className="text-lg font-black">🖼️ Thumbnail images</h2>
        <div>
          <Label>Image model</Label>
          <div className="grid grid-cols-2 gap-3">
            <Choice active={!gpt} onClick={() => set('image_model', 'gemini')} label="Gemini" hint="Nano Banana" />
            <Choice active={gpt} onClick={() => set('image_model', 'gpt')} label="ChatGPT" hint="GPT Image — OpenRouter only" />
          </div>
        </div>
        <div>
          <Label>Provider {gpt && '(ChatGPT always runs on OpenRouter)'}</Label>
          <div className="grid sm:grid-cols-3 gap-3">
            {PROVIDERS.map(p => (
              <Choice key={p.id} disabled={gpt} active={!gpt && data.image_provider === p.id}
                onClick={() => set('image_provider', p.id)} label={p.label} hint={p.hint} />
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>ChatGPT model on OpenRouter</Label>
            <input value={data.gpt_image_model} onChange={e => set('gpt_image_model', e.target.value)}
              placeholder="empty = the server's default GPT image model"
              className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-2.5 text-sm outline-none focus:border-thumb-red/50" />
          </div>
          <div>
            <Label>Gemini model on OpenRouter</Label>
            <input value={data.gemini_openrouter_image_model} onChange={e => set('gemini_openrouter_image_model', e.target.value)}
              placeholder="empty = google/<the Gemini model>"
              className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-2.5 text-sm outline-none focus:border-thumb-red/50" />
          </div>
        </div>
        <p className="text-[11px] text-thumb-sub -mt-3">Leave empty for the default. Only change these to an exact model id listed on openrouter.ai.</p>
      </div>

      <div className="thumb-glass rounded-3xl p-5 sm:p-6 mt-5 space-y-4">
        <h2 className="text-lg font-black">📝 Text &amp; everything else</h2>
        <p className="text-sm text-thumb-sub">Titles, descriptions, style tagging and matching, and the Shorts' own AI — always Gemini.</p>
        <div className="grid sm:grid-cols-3 gap-3">
          {PROVIDERS.map(p => (
            <Choice key={p.id} active={data.text_provider === p.id}
              onClick={() => set('text_provider', p.id)} label={p.label} hint={p.hint} />
          ))}
        </div>
      </div>

      <div className="thumb-glass rounded-3xl p-5 sm:p-6 mt-5 space-y-4">
        <h2 className="text-lg font-black">✂️ Shorts rendering</h2>
        <p className="text-sm text-thumb-sub">Shorts beyond these limits wait in line and start as soon as a slot frees up. Raise them after upgrading the server.</p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Per user, at once</Label>
            <input type="number" min={1} max={100} value={data.shorts_per_user}
              onChange={e => set('shorts_per_user', Number(e.target.value))}
              className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-2.5 text-sm outline-none focus:border-thumb-red/50" />
          </div>
          <div>
            <Label>Whole server, at once</Label>
            <input type="number" min={1} max={100} value={data.shorts_total}
              onChange={e => set('shorts_total', Number(e.target.value))}
              className="w-full bg-thumb-soft border border-thumb-line rounded-xl px-4 py-2.5 text-sm outline-none focus:border-thumb-red/50" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-5">
        <button type="button" onClick={save} disabled={saving}
          className="thumb-btn text-white font-bold text-sm px-6 h-11 rounded-full disabled:opacity-60">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {note && <span className={`text-sm ${note.ok ? 'text-emerald-400' : 'text-thumb-red'}`}>{note.text}</span>}
      </div>
    </section>
  );
};

export default AdminSettings;
