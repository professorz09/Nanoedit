import React, { useEffect, useRef, useState } from 'react';
import { I } from './ThumbIcons';

// ── Sketch pad ────────────────────────────────────────────────────
// Draw a rough layout (mouse, touch or stylus via pointer events) and the AI
// turns it into a finished thumbnail. A fixed 1280×720 internal buffer keeps the
// exported sketch crisp and consistent while CSS scales the surface to fit any
// screen — fully responsive on mobile and desktop.
const SKETCH_W = 1280;
const SKETCH_H = 720;
const SKETCH_COLORS = ['#111827', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'];
const SKETCH_SIZES = [4, 8, 16];

const SketchCanvas: React.FC<{ onChange: (dataUrl: string | null) => void }> = ({ onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blankRef = useRef<string>('');
  const undoStack = useRef<ImageData[]>([]);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(8);
  const [eraser, setEraser] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const ctxOf = () => canvasRef.current?.getContext('2d') || null;
  const fillWhite = (ctx: CanvasRenderingContext2D) => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, SKETCH_W, SKETCH_H); };

  // Start with a clean white page and remember its signature so we can tell
  // "still blank" from "has a drawing" without heavyweight pixel scanning.
  useEffect(() => {
    const c = canvasRef.current; const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    fillWhite(ctx);
    blankRef.current = c.toDataURL('image/png');
  }, []);

  // Failsafe: if we unmount mid-stroke (e.g. switching tabs while drawing),
  // never leave the page's text-selection locked off.
  useEffect(() => () => {
    document.body.style.userSelect = '';
    (document.body.style as any).webkitUserSelect = '';
  }, []);

  // Report the drawing to the parent — null while it's still an empty page.
  const emit = () => {
    const c = canvasRef.current;
    if (!c) return;
    const data = c.toDataURL('image/png');
    onChange(data === blankRef.current ? null : data);
  };

  // Map a pointer position to internal canvas coordinates (handles CSS scaling).
  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * SKETCH_W, y: ((e.clientY - r.top) / r.height) * SKETCH_H };
  };

  const pushUndo = () => {
    const ctx = ctxOf(); if (!ctx) return;
    undoStack.current.push(ctx.getImageData(0, 0, SKETCH_W, SKETCH_H));
    if (undoStack.current.length > 15) undoStack.current.shift();
    setCanUndo(true);
  };

  const strokeStyle = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = eraser ? '#ffffff' : color;
    ctx.fillStyle = eraser ? '#ffffff' : color;
    ctx.lineWidth = eraser ? size * 2.4 : size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const ctx = ctxOf(); if (!ctx) return;
    pushUndo();
    drawing.current = true;
    const p = pos(e);
    last.current = p;
    canvasRef.current?.setPointerCapture(e.pointerId);
    // Kill page text-selection for the whole drag: pointerdown's preventDefault
    // doesn't stop the compat mousedown, so a fast drag still selects surrounding
    // text. Lock userSelect on <body> and drop any range that already got picked.
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
    window.getSelection?.()?.removeAllRanges?.();
    strokeStyle(ctx);
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2); // dot on a single tap
    ctx.fill();
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = ctxOf(); if (!ctx || !last.current) return;
    window.getSelection?.()?.removeAllRanges?.();
    const p = pos(e);
    strokeStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    document.body.style.userSelect = '';
    (document.body.style as any).webkitUserSelect = '';
    emit();
  };

  const undo = () => {
    const ctx = ctxOf();
    const prev = undoStack.current.pop();
    if (!ctx || !prev) return;
    ctx.putImageData(prev, 0, 0);
    setCanUndo(undoStack.current.length > 0);
    emit();
  };

  const clear = () => {
    const ctx = ctxOf(); if (!ctx) return;
    pushUndo();
    fillWhite(ctx);
    emit();
  };

  return (
    <div className="space-y-3 animate-fade-in-up">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 bg-thumb-soft border border-thumb-line rounded-xl p-1.5">
          {SKETCH_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { setColor(c); setEraser(false); }}
              aria-label={`Color ${c}`}
              className={`w-6 h-6 rounded-full border transition-transform ${!eraser && color === c ? 'ring-2 ring-thumb-red ring-offset-2 ring-offset-thumb-soft scale-110' : 'border-black/10 hover:scale-110'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1 bg-thumb-soft border border-thumb-line rounded-xl p-1">
          {SKETCH_SIZES.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSize(s)}
              aria-label={`Brush ${s}`}
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${size === s ? 'thumb-liquid' : 'text-thumb-sub hover:text-thumb-ink'}`}
            >
              <span className="rounded-full bg-current" style={{ width: s / 1.7 + 3, height: s / 1.7 + 3 }} />
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setEraser(v => !v)}
          className={`h-9 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-colors ${eraser ? 'bg-thumb-red text-white border-thumb-red' : 'bg-thumb-soft border-thumb-line text-thumb-ink hover:border-thumb-red/40'}`}
        >
          <I.Eraser className="w-4 h-4" /> Erase
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          className="h-9 px-3 rounded-xl border border-thumb-line bg-thumb-soft text-thumb-ink text-xs font-bold flex items-center gap-1.5 hover:border-thumb-red/40 transition-colors disabled:opacity-40"
        >
          <I.Undo className="w-4 h-4" /> Undo
        </button>
        <button
          type="button"
          onClick={clear}
          className="h-9 px-3 rounded-xl border border-thumb-line bg-thumb-soft text-thumb-sub text-xs font-bold flex items-center gap-1.5 hover:text-thumb-red hover:border-thumb-red/40 transition-colors ml-auto"
        >
          <I.Trash className="w-4 h-4" /> Clear
        </button>
      </div>

      {/* Drawing surface — 16:9, scales to fit; touch-action:none stops the page
          from scrolling while you draw on mobile. */}
      <div className="rounded-2xl overflow-hidden border-2 border-thumb-line bg-white shadow-inner select-none">
        <canvas
          ref={canvasRef}
          width={SKETCH_W}
          height={SKETCH_H}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          className="w-full aspect-video block cursor-crosshair select-none"
          style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
        />
      </div>
    </div>
  );
};

export default SketchCanvas;
