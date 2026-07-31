import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';

interface AdminStyle {
  id: string;
  path: string;
  name: string | null;
  active: boolean;
  meta: any;
  url: string;
  created_at: string;
}

// Calls the "admin-styles" Edge Function. The function itself re-checks
// profiles.is_admin server-side on every call — this UI is only reachable
// behind that same check (see ThumbnailStudio), but the real gate is there.
const callAdmin = async (body: unknown) => {
  if (!supabase) throw new Error('Not configured.');
  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supaUrl) throw new Error('Not configured.');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Please sign in.');

  const resp = await fetch(`${supaUrl}/functions/v1/admin-styles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: supaAnon ?? '' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
  return data;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const AdminStyles: React.FC = () => {
  const [styles, setStyles] = useState<AdminStyle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [addNote, setAddNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callAdmin({ action: 'list' });
      setStyles(data.styles || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load styles.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || !f.type.startsWith('image/')) return;
    try {
      const dataUrl = await readFileAsDataUrl(f);
      setFile(f);
      setPreview(dataUrl);
    } catch {
      setAddNote('Could not read that image. Please pick another file.');
    }
  };

  const submit = async () => {
    if (!file || !preview) { setAddNote('Pick an image first.'); return; }
    setAdding(true);
    setAddNote(null);
    try {
      await callAdmin({ action: 'add', imageBase64: preview, title: title.trim() || undefined, name: name.trim() || undefined });
      setFile(null);
      setPreview(null);
      setTitle('');
      setName('');
      setAddNote('Style added.');
      refresh();
    } catch (e: any) {
      setAddNote(e?.message || 'Could not add the style.');
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (s: AdminStyle) => {
    setStyles(prev => prev.map(x => x.id === s.id ? { ...x, active: !x.active } : x)); // optimistic
    try {
      await callAdmin({ action: 'toggle', id: s.id, active: !s.active });
    } catch {
      refresh(); // revert on failure
    }
  };

  const remove = async (s: AdminStyle) => {
    if (!window.confirm('Delete this style? This cannot be undone.')) return;
    setStyles(prev => prev.filter(x => x.id !== s.id)); // optimistic
    try {
      await callAdmin({ action: 'delete', id: s.id });
    } catch {
      refresh(); // revert on failure
    }
  };

  return (
    <section className="pt-6 pb-16 max-w-5xl mx-auto">
      <h1 className="text-2xl font-black tracking-tight">Admin — Global styles</h1>
      <p className="text-sm text-thumb-sub mt-1.5">
        Add, hide, or remove thumbnails in the shared style pool. Every style here is vision-tagged and
        embedded automatically, so it works in both the manual "Styles" picker and the YouTube auto-match flow.
      </p>

      {/* Add new style */}
      <div className="thumb-glass rounded-3xl p-5 sm:p-6 mt-6 grid sm:grid-cols-[200px_1fr] gap-5">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Pick a style image"
          className="aspect-video sm:aspect-square rounded-2xl border-2 border-dashed border-thumb-line hover:border-thumb-red/40 bg-thumb-soft cursor-pointer flex items-center justify-center overflow-hidden text-thumb-sub text-xs font-bold text-center p-3"
        >
          {preview ? <img src={preview} alt="" className="w-full h-full object-cover" /> : 'Click to pick an image'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Video title (recommended)</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. How I Made $10,000 in a Week Trading Crypto"
              className="w-full mt-1 bg-thumb-soft border border-thumb-line rounded-xl px-4 py-2.5 text-sm outline-none focus:border-thumb-red/50"
            />
            <p className="text-[11px] text-thumb-sub mt-1">Improves matching — the title carries topic signal the image alone can't.</p>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Display name (optional)</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Defaults to the title"
              className="w-full mt-1 bg-thumb-soft border border-thumb-line rounded-xl px-4 py-2.5 text-sm outline-none focus:border-thumb-red/50"
            />
          </div>
          {addNote && <p className="text-xs text-thumb-sub">{addNote}</p>}
          <button
            onClick={submit}
            disabled={adding || !file}
            className="thumb-btn px-5 py-2.5 rounded-xl text-white font-bold text-sm disabled:opacity-50"
          >
            {adding ? 'Tagging + embedding…' : 'Add style'}
          </button>
        </div>
      </div>

      {/* Existing global styles */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-black uppercase tracking-wider text-thumb-sub">Current styles ({styles.length})</h2>
          <button onClick={refresh} className="text-xs font-bold text-thumb-red hover:underline">Refresh</button>
        </div>
        {loading ? (
          <p className="text-sm text-thumb-sub">Loading…</p>
        ) : error ? (
          <p className="text-sm text-thumb-red">{error}</p>
        ) : styles.length === 0 ? (
          <p className="text-sm text-thumb-sub">No global styles yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {styles.map(s => (
              <div key={s.id} className={`rounded-2xl overflow-hidden border border-thumb-line bg-thumb-card ${!s.active ? 'opacity-50' : ''}`}>
                <div className="aspect-video bg-thumb-soft"><img src={s.url} alt="" className="w-full h-full object-cover" /></div>
                <div className="p-2.5 space-y-1.5">
                  <p className="text-xs font-bold text-thumb-ink truncate" title={s.name || ''}>{s.name || '(untitled)'}</p>
                  {s.meta?.niche && <p className="text-[11px] text-thumb-sub truncate">{s.meta.niche}</p>}
                  <div className="flex gap-1.5">
                    <button onClick={() => toggle(s)} className="flex-1 py-1.5 rounded-lg bg-thumb-soft border border-thumb-line text-[11px] font-bold hover:border-thumb-red/40 transition-colors">
                      {s.active ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => remove(s)} className="flex-1 py-1.5 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-red hover:border-thumb-red/40 text-[11px] font-bold transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default AdminStyles;
