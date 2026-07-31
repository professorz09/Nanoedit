import React, { useEffect, useState } from 'react';
import { fetchPersonas, deletePersona, Persona } from '../services/personasService';
import { I } from './ThumbIcons';

// A row of the user's saved faces, shown above the upload area so a face
// uploaded once can be reused on later generations without re-uploading.
// Only fetches while `enabled` (the tab that shows it is actually open) and
// re-fetches when `refreshKey` changes (bumped after a new face is saved).
const PersonaPicker: React.FC<{
  enabled: boolean;
  refreshKey: number;
  onPick: (dataUrl: string) => void;
}> = ({ enabled, refreshKey, onPick }) => {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    fetchPersonas().then(setPersonas);
  }, [enabled, refreshKey]);

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

  if (!enabled || !personas?.length) return null;

  return (
    <div className="space-y-1">
      {error && <p className="text-[11px] text-thumb-red">{error}</p>}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
        {personas.map(p => (
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
