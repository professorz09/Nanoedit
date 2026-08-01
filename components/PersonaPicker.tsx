import React, { useEffect, useRef, useState } from 'react';
import { fetchPersonas, savePersona, deletePersona, Persona } from '../services/personasService';
import { I } from './ThumbIcons';

// A row of the user's saved faces, shown above the upload area so a face
// uploaded once can be reused on later generations without re-uploading. The
// leading "Add" tile saves a new face directly (skips the old flow of
// uploading elsewhere first, then starring the thumbnail to save it).
// Only fetches while `enabled` (the tab that shows it is actually open) and
// re-fetches when `refreshKey` changes (bumped after a new face is saved).
const PersonaPicker: React.FC<{
  enabled: boolean;
  refreshKey: number;
  onPick: (dataUrl: string) => void;
  loggedIn: boolean;
  onRequireLogin: () => void;
}> = ({ enabled, refreshKey, onPick, loggedIn, onRequireLogin }) => {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!enabled) return;
    fetchPersonas().then(setPersonas);
  }, [enabled, refreshKey]);

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });

  const addNew = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    setError(null);
    setAdding(true);
    try {
      const dataUrl = await readFile(file);
      const saved = await savePersona(dataUrl);
      setPersonas(prev => [saved, ...(prev ?? [])]);
      onPick(dataUrl);
    } catch (err: any) {
      setError(err?.message || 'Could not save that face.');
    } finally {
      setAdding(false);
    }
  };

  const pick = async (p: Persona) => {
    setBusyId(p.id);
    try {
      const res = await fetch(p.url);
      if (!res.ok) {
        // The signed URL can expire (1 day TTL) — refresh to get a live one
        // instead of turning the error response body into a "photo".
        fetchPersonas().then(setPersonas);
        return;
      }
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.readAsDataURL(blob);
      });
      onPick(dataUrl);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: Persona) => {
    setError(null);
    const ok = await deletePersona(p);
    if (ok) setPersonas(prev => prev?.filter(x => x.id !== p.id) ?? null);
    else setError('Could not remove that face. Try again.');
  };

  if (!enabled) return null;

  return (
    <div className="space-y-1">
      {error && <p className="text-[11px] text-thumb-red">{error}</p>}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
        <button
          type="button"
          onClick={() => { if (!loggedIn) { onRequireLogin(); return; } fileRef.current?.click(); }}
          disabled={adding}
          aria-label="Add a face"
          className="shrink-0 w-14 h-14 rounded-xl border-2 border-dashed border-white/12 hover:border-thumb-red text-thumb-sub hover:text-thumb-red flex flex-col items-center justify-center gap-0.5 transition-colors disabled:opacity-50"
        >
          {adding
            ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            : <><I.Upload className="w-4 h-4" /><span className="text-[10px] font-bold">Add</span></>}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={addNew} />
        {personas?.map(p => (
          <div key={p.id} className="relative shrink-0 w-14 h-14 rounded-xl overflow-hidden border border-thumb-line group">
            <button
              type="button"
              onClick={() => pick(p)}
              disabled={busyId === p.id}
              aria-label={p.name || 'Use this saved face'}
              className="w-full h-full block disabled:opacity-50"
            >
              <img src={p.url} alt={p.name || 'Saved face'} className="w-full h-full object-cover hover:scale-105 transition-transform" />
            </button>
            <button
              type="button"
              onClick={() => remove(p)}
              aria-label="Remove saved face"
              className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 hover:bg-red-500/80 text-white rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
            >
              <I.X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PersonaPicker;
