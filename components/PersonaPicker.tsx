import React, { useEffect, useRef, useState } from 'react';
import { fetchPersonas, savePersona, deletePersona, Persona } from '../services/personasService';
import { I } from './ThumbIcons';

// A row of the user's saved faces, shown above the upload area so a face
// uploaded once can be reused on later generations without re-uploading. The
// leading "Add" tile saves a new face directly (skips the old flow of
// uploading elsewhere first, then starring the thumbnail to save it). A
// matching "Pick" tile sits right beside it — same size/design as Add —
// opening a bigger grid to browse every saved face at once instead of
// scrolling a thin strip. Only fetches while `enabled` (the tab that shows it
// is actually open) and re-fetches when `refreshKey` changes (bumped after a
// new face is saved).
const PersonaPicker: React.FC<{
  enabled: boolean;
  refreshKey: number;
  onPick: (dataUrl: string) => void;
  loggedIn: boolean;
  onRequireLogin: () => void;
  /** Hide the leading "Add" tile when the caller already renders its own
   *  upload dropzone/button right next to this — avoids two upload entry
   *  points doing the same thing. Saved-face thumbnails still show. */
  showAddTile?: boolean;
  /** When set, this renders ONLY the "pick a saved face" popup (no inline
   *  Add/Pick tiles or strip) and its visibility is driven by these props
   *  instead of an internal button — for callers with their own trigger
   *  button that should open straight to picking, with no add option. */
  externalOpen?: boolean;
  onExternalClose?: () => void;
}> = ({ enabled, refreshKey, onPick, loggedIn, onRequireLogin, showAddTile = true, externalOpen, onExternalClose }) => {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const modalControlled = externalOpen !== undefined;

  useEffect(() => {
    if (!enabled || !loggedIn) { setPersonas(null); return; }
    let cancelled = false;
    // Ignore a response that lands after logout (or another logout/login
    // cycle) — otherwise a slow request from a previous session can repaint
    // someone else's saved faces on a shared device.
    fetchPersonas().then(items => { if (!cancelled) setPersonas(items); });
    return () => { cancelled = true; };
  }, [enabled, loggedIn, refreshKey]);

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
      if (saved.url) {
        setPersonas(prev => [saved, ...(prev ?? [])]);
      } else {
        // Signed-URL creation failed — the row exists but isn't usable yet.
        // Re-fetch instead of showing a broken tile; fetchPersonas already
        // filters out any row it can't sign a URL for.
        fetchPersonas().then(setPersonas);
      }
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
      setPickerOpen(false);
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

  if (!enabled || !loggedIn) return null;

  if (modalControlled) {
    if (!externalOpen) return null;
    return (
      <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onExternalClose}>
        <div className="thumb-glass border border-thumb-line rounded-2xl p-5 w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-black text-thumb-ink">Pick a saved face</h3>
            <button onClick={onExternalClose} aria-label="Close" className="w-8 h-8 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center"><I.X className="w-4 h-4" /></button>
          </div>
          {personas?.length ? (
            <div className="grid grid-cols-4 gap-3 overflow-y-auto no-scrollbar pr-0.5">
              {personas.map(p => (
                <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden border border-thumb-line group">
                  <button
                    type="button"
                    onClick={() => { pick(p); onExternalClose?.(); }}
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
                    className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-red-500/80 text-white rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  >
                    <I.X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-thumb-sub text-center py-8">No saved faces yet — upload a photo first, then save it for reuse.</p>
          )}
        </div>
      </div>
    );
  }

  if (!showAddTile && !personas?.length) return null;

  return (
    <div className="space-y-1">
      {error && <p className="text-[11px] text-thumb-red">{error}</p>}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
        {showAddTile && (
          <>
            <button
              type="button"
              onClick={() => { if (!loggedIn) { onRequireLogin(); return; } fileRef.current?.click(); }}
              disabled={adding}
              aria-label="Add a face"
              className="shrink-0 w-16 h-16 rounded-xl border-2 border-dashed border-white/12 hover:border-thumb-red text-thumb-sub hover:text-thumb-red flex flex-col items-center justify-center gap-0.5 transition-colors disabled:opacity-50"
            >
              {adding
                ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                : <><I.Upload className="w-4 h-4" /><span className="text-[10px] font-bold">Add</span></>}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={addNew} />

            {/* Same size/design as Add — opens a bigger grid to browse every
                saved face instead of scrolling this thin strip. */}
            <button
              type="button"
              onClick={() => { if (!loggedIn) { onRequireLogin(); return; } setPickerOpen(true); }}
              aria-label="Pick a saved face"
              className="shrink-0 w-16 h-16 rounded-xl border-2 border-dashed border-white/12 hover:border-thumb-red text-thumb-sub hover:text-thumb-red flex flex-col items-center justify-center gap-0.5 transition-colors"
            >
              <I.Grid className="w-4 h-4" /><span className="text-[10px] font-bold">Pick</span>
            </button>
          </>
        )}
        {personas?.map(p => (
          <div key={p.id} className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border border-thumb-line group">
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

      {pickerOpen && (
        <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="thumb-glass border border-thumb-line rounded-2xl p-5 w-full max-w-md max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-black text-thumb-ink">Pick a saved face</h3>
              <button onClick={() => setPickerOpen(false)} aria-label="Close" className="w-8 h-8 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center"><I.X className="w-4 h-4" /></button>
            </div>
            {personas?.length ? (
              <div className="grid grid-cols-4 gap-3 overflow-y-auto no-scrollbar pr-0.5">
                {personas.map(p => (
                  <div key={p.id} className="relative aspect-square rounded-xl overflow-hidden border border-thumb-line group">
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
                      className="absolute top-1 right-1 w-5 h-5 bg-black/60 hover:bg-red-500/80 text-white rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                    >
                      <I.X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-thumb-sub text-center py-8">No saved faces yet — tap Add to save one first.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PersonaPicker;
