import React, { useEffect, useRef, useState } from 'react';
import {
  fetchStyleObjects, uploadCustomStyle, deleteStyle,
  fetchPersonas, uploadPersona, deletePersona,
  type StyleRecord, type PersonaRecord,
} from '../services/stylesService';

const MAX_STYLES = 20;

// Manage the current user's OWN style thumbnails + persona faces. Global default
// styles are not shown here (they're not editable) — only the user's additions.
const StyleManager: React.FC = () => {
  const [styles, setStyles] = useState<StyleRecord[]>([]);
  const [personas, setPersonas] = useState<PersonaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'style' | 'persona' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const styleInput = useRef<HTMLInputElement>(null);
  const personaInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const [all, ps] = await Promise.all([fetchStyleObjects(), fetchPersonas()]);
    setStyles(all.filter(s => s.own));
    setPersonas(ps);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onAddStyle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy('style');
    const res = await uploadCustomStyle(file);
    setBusy(null);
    if (!res.ok) { setError(res.error || 'Could not add that style.'); return; }
    if (res.style) setStyles(prev => [...prev, res.style!]);
  };

  const onDeleteStyle = async (s: StyleRecord) => {
    setStyles(prev => prev.filter(x => x.id !== s.id));
    const ok = await deleteStyle(s.id, s.path);
    if (!ok) { setError('Could not delete — please retry.'); load(); }
  };

  const onAddPersona = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy('persona');
    const res = await uploadPersona(file);
    setBusy(null);
    if (!res.ok) { setError(res.error || 'Could not add that persona.'); return; }
    load();
  };

  const onDeletePersona = async (p: PersonaRecord) => {
    setPersonas(prev => prev.filter(x => x.id !== p.id));
    const ok = await deletePersona(p.id, p.path);
    if (!ok) { setError('Could not delete — please retry.'); load(); }
  };

  const atCap = styles.length >= MAX_STYLES;

  return (
    <div className="mt-6">
      {error && (
        <div className="mb-4 text-sm font-semibold text-thumb-red bg-thumb-soft border border-thumb-line rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* My Styles */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-black uppercase tracking-wider text-thumb-sub">My styles</h2>
        <span className="text-xs text-thumb-sub">{styles.length}/{MAX_STYLES}</span>
      </div>
      <p className="text-xs text-thumb-sub mb-3">
        Add your own thumbnails — they're auto-analysed and used in the Recreate tab and the YouTube auto-style flow, alongside the built-in styles.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {styles.map(s => (
          <div key={s.id} className="relative group aspect-video rounded-xl overflow-hidden border border-thumb-line bg-thumb-soft">
            <img src={s.url} alt={s.name || 'style'} className="w-full h-full object-cover" loading="lazy" />
            <button
              onClick={() => onDeleteStyle(s)}
              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-black/60 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-thumb-red"
              title="Delete style"
            >✕</button>
          </div>
        ))}
        {!atCap && (
          <button
            onClick={() => styleInput.current?.click()}
            disabled={busy === 'style'}
            className="aspect-video rounded-xl border-2 border-dashed border-thumb-line text-thumb-sub hover:text-thumb-ink hover:border-thumb-ink transition-colors flex flex-col items-center justify-center gap-1 disabled:opacity-60"
          >
            {busy === 'style'
              ? <><span className="w-5 h-5 border-2 border-thumb-sub border-t-transparent rounded-full animate-spin" /><span className="text-xs font-bold">Analysing…</span></>
              : <><span className="text-2xl leading-none">+</span><span className="text-xs font-bold">Add style</span></>}
          </button>
        )}
      </div>
      {loading && <p className="text-sm text-thumb-sub mt-3">Loading…</p>}
      {!loading && styles.length === 0 && busy !== 'style' && (
        <p className="text-sm text-thumb-sub mt-3">No custom styles yet. Add a thumbnail to get started.</p>
      )}
      <input ref={styleInput} type="file" accept="image/*" hidden onChange={onAddStyle} />

      {/* My Persona */}
      <div className="flex items-center justify-between mb-3 mt-8">
        <h2 className="text-sm font-black uppercase tracking-wider text-thumb-sub">My persona</h2>
      </div>
      <p className="text-xs text-thumb-sub mb-3">
        Save your face photos privately — reuse them anywhere the app swaps a person into a thumbnail.
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {personas.map(p => (
          <div key={p.id} className="relative group aspect-square rounded-xl overflow-hidden border border-thumb-line bg-thumb-soft">
            {p.url ? <img src={p.url} alt={p.name || 'persona'} className="w-full h-full object-cover" loading="lazy" /> : null}
            <button
              onClick={() => onDeletePersona(p)}
              className="absolute top-1.5 right-1.5 w-7 h-7 rounded-lg bg-black/60 text-white text-sm opacity-0 group-hover:opacity-100 transition-opacity hover:bg-thumb-red"
              title="Delete persona"
            >✕</button>
          </div>
        ))}
        <button
          onClick={() => personaInput.current?.click()}
          disabled={busy === 'persona'}
          className="aspect-square rounded-xl border-2 border-dashed border-thumb-line text-thumb-sub hover:text-thumb-ink hover:border-thumb-ink transition-colors flex flex-col items-center justify-center gap-1 disabled:opacity-60"
        >
          {busy === 'persona'
            ? <span className="w-5 h-5 border-2 border-thumb-sub border-t-transparent rounded-full animate-spin" />
            : <><span className="text-2xl leading-none">+</span><span className="text-[11px] font-bold">Add face</span></>}
        </button>
      </div>
      <input ref={personaInput} type="file" accept="image/*" hidden onChange={onAddPersona} />
    </div>
  );
};

export default StyleManager;
