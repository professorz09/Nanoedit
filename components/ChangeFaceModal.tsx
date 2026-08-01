import React, { useRef, useState } from 'react';
import { I } from './ThumbIcons';
import PersonaPicker from './PersonaPicker';
import { urlToBase64 } from '../services/youtubeService';

interface FaceSlot { id: string; image: string | null; instruction: string; }

const newSlot = (): FaceSlot => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, image: null, instruction: '' });

const readFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

// "Change face" — fix a wrong/unwanted face in an already-generated thumbnail
// (e.g. one pulled in from a reference-style image) without redoing the whole
// generation. Supports MULTIPLE faces in one image, each with its own
// replacement photo (upload or a saved persona) and a short instruction
// describing which face it is ("the man on the left", "green shirt").
const ChangeFaceModal: React.FC<{
  targetUrl: string;
  onClose: () => void;
  onSubmit: (prompt: string, sources: string[]) => void;
  loggedIn: boolean;
  onRequireLogin: () => void;
  personaRefreshKey: number;
}> = ({ targetUrl, onClose, onSubmit, loggedIn, onRequireLogin, personaRefreshKey }) => {
  const [slots, setSlots] = useState<FaceSlot[]>([newSlot()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const addSlot = () => setSlots(prev => (prev.length >= 4 ? prev : [...prev, newSlot()]));
  const removeSlot = (id: string) => setSlots(prev => (prev.length <= 1 ? prev : prev.filter(s => s.id !== id)));
  const setSlotImage = (id: string, image: string | null) => setSlots(prev => prev.map(s => (s.id === id ? { ...s, image } : s)));
  const setSlotInstruction = (id: string, instruction: string) => setSlots(prev => prev.map(s => (s.id === id ? { ...s, instruction } : s)));

  const handleUpload = async (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await readFile(file);
    setSlotImage(id, dataUrl);
  };

  const filled = slots.filter(s => s.image);
  const canSubmit = filled.length > 0 && !busy;

  const apply = async () => {
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const targetB64 = await urlToBase64(targetUrl);
      if (!targetB64) { setError('Could not load that thumbnail. Try again.'); return; }
      const lines = filled.map((s, i) => {
        const who = s.instruction.trim() || (filled.length === 1 ? 'the main person' : `person ${i + 1}`);
        return `Reference photo ${i + 2} shows a replacement person for "${who}" — find that person in the FIRST image and swap them in: replace ONLY their face/head, preserving the original pose, head angle, scale, expression and lighting so they blend in seamlessly and look completely real. `;
      }).join('');
      const prompt = `You are EDITING the FIRST image — an existing, finished YouTube thumbnail. Reproduce it EXACTLY: keep the same composition, layout, background, props, graphics, on-image text and colour grade unchanged. Do NOT restyle, redraw or move anything that isn't being changed. ${lines}Do not add, remove, invent, duplicate or alter any other person, object or text on the image. Keep the result photorealistic with natural skin texture and a sharp, fully-detailed face, rendered at maximum fidelity — crisp, no blur, noise, artifacts, warping or distorted anatomy. Output the image in the SAME aspect ratio and shape as the original.`;
      onSubmit(prompt, [targetB64, ...filled.map(s => s.image!)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="thumb-glass border border-thumb-line rounded-2xl p-5 w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-base font-black text-thumb-ink">Change face</h3>
            <p className="text-xs text-thumb-sub mt-0.5">Swap in the right person — upload a photo or pick a saved face</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 shrink-0 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center"><I.X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-3 my-3 shrink-0">
          <img src={targetUrl} alt="Thumbnail to fix" className="w-24 aspect-video object-cover rounded-lg border border-thumb-line shrink-0" />
          <p className="text-[11px] text-thumb-sub leading-relaxed self-center">Everything else — layout, text, background — stays exactly the same. Only the face(s) you specify below get replaced.</p>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pr-0.5">
          {slots.map((slot, i) => (
            <div key={slot.id} className="bg-thumb-soft border border-thumb-line rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Face {i + 1}</span>
                {slots.length > 1 && (
                  <button onClick={() => removeSlot(slot.id)} aria-label={`Remove face ${i + 1}`} className="text-thumb-sub hover:text-thumb-red transition-colors"><I.X className="w-3.5 h-3.5" /></button>
                )}
              </div>

              {slot.image ? (
                <div className="flex items-center gap-3">
                  <img src={slot.image} alt={`Replacement face ${i + 1}`} className="w-14 h-14 rounded-lg object-cover border border-thumb-line" />
                  <button onClick={() => setSlotImage(slot.id, null)} className="text-xs font-bold text-thumb-red hover:underline">Change photo</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => { if (!loggedIn) { onRequireLogin(); return; } fileRefs.current[slot.id]?.click(); }}
                    className="w-full h-11 rounded-lg border-2 border-dashed border-thumb-line hover:border-thumb-red text-thumb-sub hover:text-thumb-red text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <I.Upload className="w-4 h-4" /> Upload a photo
                  </button>
                  <input ref={el => { fileRefs.current[slot.id] = el; }} type="file" accept="image/*" className="hidden" onChange={e => handleUpload(slot.id, e)} />
                  <PersonaPicker
                    enabled
                    refreshKey={personaRefreshKey}
                    onPick={(dataUrl) => setSlotImage(slot.id, dataUrl)}
                    loggedIn={loggedIn}
                    onRequireLogin={onRequireLogin}
                    showAddTile={false}
                  />
                </div>
              )}

              <input
                value={slot.instruction}
                onChange={e => setSlotInstruction(slot.id, e.target.value)}
                placeholder={slots.length > 1 ? "Which face? e.g. “the man on the left” or “green shirt”" : 'Which face? (optional if only one person)'}
                className="w-full bg-thumb-card border border-thumb-line rounded-lg px-3 py-2 text-xs outline-none placeholder-thumb-sub/60 focus:border-thumb-red/50"
              />
            </div>
          ))}

          {slots.length < 4 && (
            <button onClick={addSlot} className="w-full py-2.5 rounded-xl border border-dashed border-thumb-line text-thumb-sub hover:text-thumb-red hover:border-thumb-red/40 text-xs font-bold transition-colors">
              + Add another face
            </button>
          )}
        </div>

        {error && <p className="text-xs text-thumb-red mt-3">{error}</p>}

        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-thumb-line shrink-0">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-thumb-soft border border-thumb-line text-thumb-ink text-xs font-bold hover:bg-thumb-line/60 transition-colors">Cancel</button>
          <button
            onClick={apply}
            disabled={!canSubmit}
            className="flex-1 thumb-btn py-2.5 rounded-xl text-white text-xs font-black disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChangeFaceModal;
