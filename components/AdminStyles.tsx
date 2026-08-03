import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';

interface AdminStyle {
  id: string;
  path: string;
  name: string | null;
  active: boolean;
  show_in_picker: boolean;
  meta: any;
  sort: number | null;
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
      const data = await callAdmin({ action: 'add', imageBase64: preview, title: title.trim() || undefined, name: name.trim() || undefined });
      if (data?.style) setStyles(prev => [data.style, ...prev]); // no full refresh/refetch — avoids the whole grid flashing to "Loading…"
      setFile(null);
      setPreview(null);
      setTitle('');
      setName('');
      setAddNote('Style added.');
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

  // Independent of `active` above — this only affects the manual "Styles"
  // picker. The style stays fully eligible for YouTube auto-matching either
  // way, since match_styles() never checks show_in_picker.
  // pendingPickerIds disables a style's own button while its toggle is in
  // flight — without it, a rapid double-click fires two overlapping updates
  // that the server can apply out of order, leaving the shown state (which is
  // purely optimistic, never re-synced after success) wrong.
  const [pendingPickerIds, setPendingPickerIds] = useState<Set<string>>(new Set());
  const togglePicker = async (s: AdminStyle) => {
    const next = !s.show_in_picker;
    setPendingPickerIds(prev => new Set(prev).add(s.id));
    setStyles(prev => prev.map(x => x.id === s.id ? { ...x, show_in_picker: next } : x)); // optimistic
    try {
      await callAdmin({ action: 'toggle_picker', id: s.id, show_in_picker: next });
      setStyles(prev => prev.map(x => x.id === s.id ? { ...x, show_in_picker: next } : x)); // reconcile with the confirmed value
    } catch {
      refresh(); // revert on failure
    } finally {
      setPendingPickerIds(prev => { const n = new Set(prev); n.delete(s.id); return n; });
    }
  };

  // Position within the manual "Styles" picker — lower shows first; unranked
  // (null) always falls in behind every ranked style (see
  // stylesService.fetchStyleImages' `.order('sort', { ascending: true,
  // nullsFirst: false })`). Local draft text per style so typing doesn't
  // fight the input, committed on blur/Enter rather than on every keystroke.
  // An empty field commits as "clear back to unranked", not 0 — 0 is now a
  // real top-priority rank, not a placeholder for "never touched".
  const sortCompare = (a: number | null, b: number | null) =>
    a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : a - b;
  const [sortDrafts, setSortDrafts] = useState<Record<string, string>>({});
  const commitSort = async (s: AdminStyle) => {
    const raw = sortDrafts[s.id];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    const next = trimmed === '' ? null : Number(trimmed);
    if ((next !== null && !Number.isFinite(next)) || next === s.sort) {
      setSortDrafts(prev => { const n = { ...prev }; delete n[s.id]; return n; });
      return;
    }
    // Re-sort locally too, same order the server list/picker use, so the
    // grid immediately reflects the new position instead of waiting for a
    // manual refresh.
    setStyles(prev => prev.map(x => x.id === s.id ? { ...x, sort: next } : x)
      .sort((a, b) => sortCompare(a.sort, b.sort) || (a.created_at < b.created_at ? 1 : -1)));
    setSortDrafts(prev => { const n = { ...prev }; delete n[s.id]; return n; });
    try {
      await callAdmin({ action: 'set_sort', id: s.id, sort: next });
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

  // Hand-correct a style's tags (e.g. a wrong niche) instead of only ever
  // being able to re-run AI vision tagging from scratch. One form open at a
  // time; a comma-joined string in the UI for the list fields (keywords/
  // colors), split back into arrays on save.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ niche: string; emotion: string; composition: string; summary: string; text_density: string; keywords: string; colors: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const startEdit = (s: AdminStyle) => {
    const m = s.meta || {};
    setEditingId(s.id);
    setEditError(null);
    setEditDraft({
      niche: m.niche || '',
      emotion: m.emotion || '',
      composition: m.composition || '',
      summary: m.summary || '',
      text_density: m.text_density || 'none',
      keywords: Array.isArray(m.keywords) ? m.keywords.join(', ') : '',
      colors: Array.isArray(m.colors) ? m.colors.join(', ') : '',
    });
  };
  const cancelEdit = () => { setEditingId(null); setEditDraft(null); setEditError(null); };

  const saveEdit = async (s: AdminStyle) => {
    if (!editDraft) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const meta = {
        niche: editDraft.niche.trim(),
        emotion: editDraft.emotion.trim(),
        composition: editDraft.composition.trim(),
        summary: editDraft.summary.trim(),
        text_density: editDraft.text_density,
        keywords: editDraft.keywords.split(',').map(k => k.trim()).filter(Boolean),
        colors: editDraft.colors.split(',').map(c => c.trim()).filter(Boolean),
      };
      const data = await callAdmin({ action: 'update_meta', id: s.id, meta });
      setStyles(prev => prev.map(x => x.id === s.id ? { ...x, meta: data.meta ?? { ...x.meta, ...meta } } : x));
      cancelEdit();
    } catch (e: any) {
      setEditError(e?.message || 'Could not save these tags.');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <section className="pt-6 pb-16 max-w-5xl mx-auto">
      <h1 className="text-2xl font-black tracking-tight">Admin — Global styles</h1>
      <p className="text-sm text-thumb-sub mt-1.5">
        Add, disable, or remove thumbnails in the shared style pool. Every style here is vision-tagged and
        embedded automatically, so it works in both the manual "Styles" picker and the YouTube auto-match flow.
        "Hide from picker" only affects the manual picker — the style stays fully eligible for auto-matching.
        The small number on each card controls its position in the manual picker — lower shows first.
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
            <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Video title (optional)</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. How I Made $10,000 in a Week Trading Crypto"
              className="w-full mt-1 bg-thumb-soft border border-thumb-line rounded-xl px-4 py-2.5 text-sm outline-none focus:border-thumb-red/50"
            />
            <p className="text-[11px] text-thumb-sub mt-1">Only a minor hint to break a tie when the image alone is ambiguous — tagging is based on what's actually in the image, and the title itself isn't stored.</p>
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
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-thumb-ink truncate flex-1" title={s.name || ''}>{s.name || '(untitled)'}</p>
                    <input
                      type="number"
                      value={sortDrafts[s.id] ?? (s.sort === null ? '' : String(s.sort))}
                      onChange={e => setSortDrafts(prev => ({ ...prev, [s.id]: e.target.value }))}
                      onBlur={() => commitSort(s)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      placeholder="—"
                      title="Order in the manual Styles picker — lower shows first. Blank = unranked, falls in behind every ranked style."
                      aria-label="Picker order (lower shows first, blank = unranked)"
                      className="w-12 shrink-0 bg-thumb-soft border border-thumb-line rounded-md px-1.5 py-0.5 text-[11px] text-center outline-none focus:border-thumb-red/50"
                    />
                  </div>
                  {s.meta?.niche && <p className="text-[11px] text-thumb-sub truncate">{s.meta.niche}</p>}
                  {s.active && !s.show_in_picker && (
                    <p className="text-[10px] text-thumb-sub">Hidden from picker · still auto-matches</p>
                  )}
                  <div className="flex gap-1.5">
                    <button onClick={() => toggle(s)} className="flex-1 py-1.5 rounded-lg bg-thumb-soft border border-thumb-line text-[11px] font-bold hover:border-thumb-red/40 transition-colors">
                      {s.active ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => remove(s)} className="flex-1 py-1.5 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-red hover:border-thumb-red/40 text-[11px] font-bold transition-colors">
                      Delete
                    </button>
                  </div>
                  <button
                    onClick={() => togglePicker(s)}
                    disabled={!s.active || pendingPickerIds.has(s.id)}
                    className="w-full py-1.5 rounded-lg bg-thumb-soft border border-thumb-line text-[11px] font-bold hover:border-thumb-red/40 transition-colors disabled:opacity-50"
                  >
                    {s.show_in_picker ? 'Hide from picker' : 'Show in picker'}
                  </button>
                  <button
                    onClick={() => editingId === s.id ? cancelEdit() : startEdit(s)}
                    className="w-full py-1.5 rounded-lg bg-thumb-soft border border-thumb-line text-[11px] font-bold hover:border-thumb-red/40 transition-colors"
                  >
                    {editingId === s.id ? 'Cancel' : 'Edit tags'}
                  </button>

                  {editingId === s.id && editDraft && (
                    <div className="space-y-1.5 pt-1.5 border-t border-thumb-line">
                      <input
                        value={editDraft.niche}
                        onChange={e => setEditDraft(d => d && { ...d, niche: e.target.value })}
                        placeholder="Niche (e.g. finance)"
                        className="w-full bg-thumb-soft border border-thumb-line rounded-md px-2 py-1 text-[11px] outline-none focus:border-thumb-red/50"
                      />
                      <input
                        value={editDraft.keywords}
                        onChange={e => setEditDraft(d => d && { ...d, keywords: e.target.value })}
                        placeholder="Keywords, comma separated"
                        className="w-full bg-thumb-soft border border-thumb-line rounded-md px-2 py-1 text-[11px] outline-none focus:border-thumb-red/50"
                      />
                      <input
                        value={editDraft.emotion}
                        onChange={e => setEditDraft(d => d && { ...d, emotion: e.target.value })}
                        placeholder="Emotion (e.g. shock)"
                        className="w-full bg-thumb-soft border border-thumb-line rounded-md px-2 py-1 text-[11px] outline-none focus:border-thumb-red/50"
                      />
                      <input
                        value={editDraft.colors}
                        onChange={e => setEditDraft(d => d && { ...d, colors: e.target.value })}
                        placeholder="Colors, comma separated"
                        className="w-full bg-thumb-soft border border-thumb-line rounded-md px-2 py-1 text-[11px] outline-none focus:border-thumb-red/50"
                      />
                      <input
                        value={editDraft.composition}
                        onChange={e => setEditDraft(d => d && { ...d, composition: e.target.value })}
                        placeholder="Composition"
                        className="w-full bg-thumb-soft border border-thumb-line rounded-md px-2 py-1 text-[11px] outline-none focus:border-thumb-red/50"
                      />
                      <select
                        value={editDraft.text_density}
                        onChange={e => setEditDraft(d => d && { ...d, text_density: e.target.value })}
                        className="w-full bg-thumb-soft border border-thumb-line rounded-md px-2 py-1 text-[11px] outline-none focus:border-thumb-red/50"
                      >
                        <option value="none">Text: none</option>
                        <option value="low">Text: low</option>
                        <option value="high">Text: high</option>
                      </select>
                      <textarea
                        value={editDraft.summary}
                        onChange={e => setEditDraft(d => d && { ...d, summary: e.target.value })}
                        placeholder="Summary"
                        rows={2}
                        className="w-full bg-thumb-soft border border-thumb-line rounded-md px-2 py-1 text-[11px] outline-none focus:border-thumb-red/50 resize-none"
                      />
                      {editError && <p className="text-[10px] text-thumb-red">{editError}</p>}
                      <button
                        onClick={() => saveEdit(s)}
                        disabled={savingEdit}
                        className="w-full py-1.5 rounded-lg thumb-btn text-white text-[11px] font-bold disabled:opacity-50"
                      >
                        {savingEdit ? 'Saving + re-indexing…' : 'Save tags'}
                      </button>
                    </div>
                  )}
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
