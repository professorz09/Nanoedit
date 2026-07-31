import React from 'react';
import SafeImage from './SafeImage';
import { ASPECT_RATIOS, STYLES, CAMERA_ANGLES, PRESET_PROMPTS } from '../types';
import {
  IconUpload, IconSparkles, IconAspectRatio, IconX, IconDownload, IconPalette,
  IconToggleLeft, IconToggleRight, IconLayers, IconEye, IconLayerPlus, IconZip,
  IconEraser, IconTrash, IconZoomIn, IconZoomOut, IconSettings, IconCamera,
} from './Icons';

// Props are the App-level state/handlers the editor reads. The project ships
// without @types/react, so precise setter/event types add no real safety here —
// they're typed permissively; correctness is enforced by the shared NAMES list
// used to generate both this destructure and App's call site.
interface EditorViewProps {
  theme: any;
  uiVisible: any;
  setUiVisible: any;
  setView: any;
  isImageMode: any;
  setIsImageMode: any;
  sourceImages: any;
  clearAllSourceImages: any;
  triggerFileUpload: any;
  handleDragOver: any;
  handleDrop: any;
  fileInputRef: any;
  handleFileUpload: any;
  styleImages: any;
  showStylePicker: any;
  setShowStylePicker: any;
  removeSourceImage: any;
  viewedImage: any;
  setViewedImage: any;
  textResponse: any;
  setTextResponse: any;
  globalError: any;
  setGlobalError: any;
  generatedImages: any;
  queue: any;
  itemTimers: any;
  isProcessing: any;
  retryQueueItem: any;
  cancelQueueItem: any;
  loadedSrcs: any;
  markLoaded: any;
  copyPromptFromImage: any;
  copiedPromptId: any;
  handleBrushSelect: any;
  addToLayers: any;
  downloadImage: any;
  deleteGeneratedImage: any;
  onBrokenImage?: (id: string, url: string) => void;
  prompt: any;
  setPrompt: any;
  handleGenerate: any;
  settings: any;
  setSettings: any;
  batchCount: any;
  setBatchCount: any;
  handleRemoveBackground: any;
  handleDownloadAll: any;
  clearAllGeneratedImages: any;
  showHelp: any;
  setShowHelp: any;
  showMobileTools: any;
  setShowMobileTools: any;
  brushMode: any;
  setBrushMode: any;
  brushPanelMin: any;
  setBrushPanelMin: any;
  brushTool: any;
  setBrushTool: any;
  brushSize: any;
  setBrushSize: any;
  annotations: any;
  setAnnotations: any;
  clearBrushSelection: any;
  applyEditorSelection: any;
  zoom: any;
  setZoom: any;
  pan: any;
  setPan: any;
  isDragging: any;
  handleZoomOut: any;
  handleZoomIn: any;
  handleMouseDown: any;
  handleMouseMove: any;
  handleMouseUp: any;
  handleWheel: any;
  handleTouchStart: any;
  handleTouchMove: any;
  handleTouchEnd: any;
  imageLoadError: any;
  setImageLoadError: any;
  canvasRef: any;
  startDrawing: any;
  draw: any;
  stopDrawing: any;
  addAnnotation: any;
  setSelectedArea: any;
  handleViewerRemoveBg: any;
}

// Full-screen PodcastFlux canvas editor — extracted verbatim from App.tsx and
// React.lazy-loaded so its ~760 lines of markup stay out of the initial studio
// bundle, downloading only when a user opens the editor.
export default function EditorView(props: EditorViewProps) {
  const {
    theme,
    uiVisible,
    setUiVisible,
    setView,
    isImageMode,
    setIsImageMode,
    sourceImages,
    clearAllSourceImages,
    triggerFileUpload,
    handleDragOver,
    handleDrop,
    fileInputRef,
    handleFileUpload,
    styleImages,
    showStylePicker,
    setShowStylePicker,
    removeSourceImage,
    viewedImage,
    setViewedImage,
    textResponse,
    setTextResponse,
    globalError,
    setGlobalError,
    generatedImages,
    queue,
    itemTimers,
    isProcessing,
    retryQueueItem,
    cancelQueueItem,
    loadedSrcs,
    markLoaded,
    copyPromptFromImage,
    copiedPromptId,
    handleBrushSelect,
    addToLayers,
    downloadImage,
    deleteGeneratedImage,
    onBrokenImage,
    prompt,
    setPrompt,
    handleGenerate,
    settings,
    setSettings,
    batchCount,
    setBatchCount,
    handleRemoveBackground,
    handleDownloadAll,
    clearAllGeneratedImages,
    showHelp,
    setShowHelp,
    showMobileTools,
    setShowMobileTools,
    brushMode,
    setBrushMode,
    brushPanelMin,
    setBrushPanelMin,
    brushTool,
    setBrushTool,
    brushSize,
    setBrushSize,
    annotations,
    setAnnotations,
    clearBrushSelection,
    applyEditorSelection,
    zoom,
    setZoom,
    pan,
    setPan,
    isDragging,
    handleZoomOut,
    handleZoomIn,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    imageLoadError,
    setImageLoadError,
    canvasRef,
    startDrawing,
    draw,
    stopDrawing,
    addAnnotation,
    setSelectedArea,
    handleViewerRemoveBg,
  } = props;

  // ── Draggable brush panel ──────────────────────────────────────────────────
  // The edit-tools panel can be grabbed by its header and moved anywhere on
  // screen (any side), so it never blocks the area you're painting. `panelPos`
  // null = default docked position; once dragged it holds absolute viewport
  // coords. Reset to docked each time the brush editor (re)opens.
  const [panelPos, setPanelPos] = React.useState<{ x: number; y: number } | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const dragOff = React.useRef<{ dx: number; dy: number } | null>(null);

  React.useEffect(() => { if (!brushMode) setPanelPos(null); }, [brushMode]);

  const onPanelDragStart = (e: any) => {
    e.stopPropagation();
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    dragOff.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no-op */ }
  };
  const onPanelDragMove = (e: any) => {
    if (!dragOff.current) return;
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 248;
    const h = el?.offsetHeight ?? 200;
    const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
    setPanelPos({
      x: clamp(e.clientX - dragOff.current.dx, 4, window.innerWidth - w - 4),
      y: clamp(e.clientY - dragOff.current.dy, 4, window.innerHeight - h - 4),
    });
  };
  const onPanelDragEnd = () => { dragOff.current = null; };

  // ── Canvas-style brush cursor ───────────────────────────────────────────────
  // A ring that follows the pointer and matches the real brush footprint, so you
  // can see exactly what you'll paint (the native cursor is hidden over the
  // canvas). Diameter = brushSize scaled from canvas-native px to on-screen px
  // (rect already includes the zoom transform).
  const [brushCursor, setBrushCursor] = React.useState<{ x: number; y: number; d: number } | null>(null);
  const updateBrushCursor = (e: any) => {
    const c = canvasRef?.current;
    if (!c || brushTool !== 'brush') { setBrushCursor(null); return; }
    const rect = c.getBoundingClientRect();
    const d = brushSize * (rect.width / (c.width || rect.width));
    setBrushCursor({ x: e.clientX, y: e.clientY, d });
  };

  return (
    <div className={`thumb-scope min-h-screen bg-thumb-bg text-thumb-ink selection:bg-nano-accent selection:text-white flex flex-col font-sans ${theme === 'light' ? 'thumb-light' : ''}`}>

      {/* Mobile header — back + brand. */}
      <header className={`lg:hidden sticky top-0 z-30 px-4 h-14 flex items-center gap-2.5 thumb-glass border-b border-thumb-line transition-opacity duration-300 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <button
            onClick={() => setView('studio')}
            title="Back to PodcastFlux"
            className="group w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink hover:border-thumb-red/40 transition-all"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div className="thumb-btn w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"><IconSparkles /></div>
          <div className="leading-tight">
            <div className="font-extrabold tracking-tight text-[15px] text-thumb-ink">PodcastFlux Editor</div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-thumb-sub">Canvas Editor</div>
          </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 pt-4 sm:pt-6 pb-44 lg:pb-16">
        <div className="grid lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] gap-6 items-start">
        <div className="min-w-0 order-2">
        <div className="thumb-glass rounded-3xl p-4 sm:p-5 flex flex-col gap-5 min-h-[60vh] lg:min-h-[calc(100vh-3rem)]">

            {(generatedImages.length > 0 || queue.length > 0) && (
                <div className="flex items-center justify-end gap-2">
                    <span className="text-xs font-bold text-thumb-sub">{isProcessing ? 'Generating…' : `${generatedImages.length} image${generatedImages.length === 1 ? '' : 's'}`}{queue.length > 0 && !isProcessing ? ` · ${queue.length} queued` : ''}</span>
                </div>
            )}

            {isImageMode && uiVisible && (
                <div className="w-full flex flex-col items-start gap-2 animate-fade-in-up">
                    <div className="flex items-center justify-between w-full px-1">
                         <span className="text-xs font-semibold text-thumb-sub uppercase tracking-wider flex items-center gap-2">
                            <IconLayers /> Input Layers ({sourceImages.length})
                        </span>
                        {sourceImages.length > 0 && (
                            <button onClick={clearAllSourceImages} className="text-xs text-red-400 hover:text-red-300 transition-colors">Clear (Esc)</button>
                        )}
                    </div>
                    
                    <div className="flex items-center gap-3 overflow-x-auto w-full pb-2 no-scrollbar">
                         <div 
                            className="shrink-0 w-24 h-24 border-2 border-dashed border-thumb-line rounded-xl flex flex-col items-center justify-center gap-1 text-thumb-sub hover:border-nano-accent hover:text-nano-accent transition-all cursor-pointer bg-thumb-soft"
                            onClick={triggerFileUpload}
                            onDragOver={handleDragOver}
                            onDrop={handleDrop}
                            title="Upload Image"
                        >
                            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" multiple />
                            <IconUpload />
                            <span className="text-[10px] font-medium">Add</span>
                        </div>
                        {styleImages.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowStylePicker(true)}
                                className="shrink-0 w-24 h-24 border-2 border-dashed border-thumb-line rounded-xl flex flex-col items-center justify-center gap-1 text-thumb-sub hover:border-nano-accent hover:text-nano-accent transition-all cursor-pointer bg-thumb-soft"
                                title="Add from styles"
                            >
                                <IconPalette />
                                <span className="text-[10px] font-medium">Styles</span>
                            </button>
                        )}
                        {sourceImages.map((img, idx) => (
                            <div key={idx} className="relative group shrink-0 w-24 h-24 rounded-xl overflow-hidden shadow-lg border border-thumb-line animate-fade-in-up" style={{ animationDelay: `${idx * 50}ms` }}>
                                <img src={img} alt={`Source ${idx}`} className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-200" onClick={() => setViewedImage(img)} />
                                <div className="absolute top-1 left-1 bg-nano-accent text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                    {idx + 1}
                                </div>
                                <button 
                                    onClick={() => removeSourceImage(idx)}
                                    className="absolute top-1 right-1 p-1 bg-black/60 hover:bg-red-500/80 rounded-full text-white backdrop-blur-md transition-colors opacity-0 group-hover:opacity-100"
                                >
                                    <IconX />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {textResponse && uiVisible && (
                <div className="w-full max-w-4xl mx-auto animate-fade-in-up">
                    <div className="bg-thumb-card border border-thumb-line rounded-xl p-6 shadow-lg relative">
                        <button
                            onClick={() => setTextResponse(null)}
                            className="absolute top-4 right-4 p-1 text-thumb-sub hover:text-thumb-ink transition-colors"
                        >
                            <IconX />
                        </button>
                        <h3 className="text-thumb-sub text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                            <IconSparkles /> AI Response
                        </h3>
                        <div className="prose prose-sm max-w-none whitespace-pre-wrap font-mono text-thumb-ink">
                            {textResponse}
                        </div>
                    </div>
                </div>
            )}

            {globalError && uiVisible && (
                <div className="w-full animate-fade-in-up">
                    <div className="bg-thumb-redSoft border border-thumb-red/40 rounded-xl p-4 shadow-lg relative overflow-hidden">
                        <button
                            onClick={() => setGlobalError(null)}
                            className="absolute top-3 right-3 p-1 text-red-300 hover:text-red-200 transition-colors"
                            aria-label="Dismiss error"
                        >
                            <IconX />
                        </button>
                        <h3 className="text-thumb-red text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">⚠ Error</h3>
                        <p className="text-sm text-red-200 pr-8 leading-relaxed">{globalError}</p>
                        {/* Auto-dismiss progress bar */}
                        <div className="absolute bottom-0 left-0 h-0.5 bg-red-500/20 w-full">
                            <div className="h-full bg-red-400/60" style={{ animation: 'progress-shrink 6s linear forwards' }} />
                        </div>
                    </div>
                </div>
            )}

            {(generatedImages.length > 0 || queue.length > 0) && (
                <div className="w-full">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 w-full animate-fade-in-up">
                        
                        {/* Queue Items Rendering - Sort to show failed items last */}
                        {[...queue].sort((a, b) => {
                            if (a.status === 'failed' && b.status !== 'failed') return 1;
                            if (a.status !== 'failed' && b.status === 'failed') return -1;
                            return 0;
                        }).map((item, idx) => (
                             <div key={item.id} className="relative aspect-square rounded-xl bg-thumb-soft border border-thumb-line flex flex-col items-center justify-center gap-3 shadow-[0_0_15px_rgba(255,51,85,0.05)] overflow-hidden">
                                {item.status === 'processing' ? (
                                    <>
                                        <div className="w-10 h-10 border-2 border-nano-accent border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-nano-accent text-sm font-mono">{(itemTimers[item.id] || 0).toFixed(1)}s</span>
                                        <p className="text-xs text-thumb-sub px-4 text-center line-clamp-1 absolute bottom-4 w-full">{item.prompt}</p>
                                    </>
                                ) : item.status === 'failed' ? (
                                     <>
                                        <div className="w-full h-full flex flex-col items-center justify-center p-6 space-y-4 bg-thumb-redSoft">
                                            <div className="relative">
                                                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-red-900/40 to-red-950/40 border border-red-800/30 flex items-center justify-center backdrop-blur-sm shadow-lg">
                                                    <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                    </svg>
                                                </div>
                                                <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-red-500 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-lg border-2 border-thumb-card">
                                                    ✕
                                                </div>
                                            </div>
                                            <div className="text-center space-y-1.5">
                                                <h4 className="text-base font-bold text-white">Generation Failed</h4>
                                                {item.error && (
                                                    <p className="text-[11px] text-red-200/90 line-clamp-2 max-w-[220px] leading-relaxed">{item.error}</p>
                                                )}
                                            </div>
                                            <div className="flex gap-2.5 w-full px-2">
                                                <button 
                                                    onClick={() => retryQueueItem(item)} 
                                                    className="flex-1 px-4 py-3 bg-gradient-to-r from-nano-accent via-nano-accent to-nano-accentHover text-white text-sm font-bold rounded-xl hover:shadow-xl hover:shadow-nano-accent/30 transition-all hover:scale-105 active:scale-95"
                                                >
                                                    <div className="flex items-center justify-center gap-2">
                                                        <span className="text-base">🔄</span>
                                                        <span>Try Again</span>
                                                    </div>
                                                </button>
                                                <button 
                                                    onClick={() => cancelQueueItem(item.id)} 
                                                    className="w-12 h-12 bg-black/25 hover:bg-red-900/50 border border-white/15 hover:border-red-800 text-red-100 hover:text-white text-sm font-bold rounded-xl transition-all hover:scale-105 active:scale-95 flex items-center justify-center"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="w-8 h-8 rounded-full border-2 border-thumb-line border-dotted animate-pulse"></div>
                                        <span className="text-thumb-sub text-xs font-bold uppercase tracking-widest">Waiting...</span>
                                        <div className="absolute top-2 left-2 text-[10px] text-thumb-sub font-mono">#{idx + 1}</div>
                                        <p className="text-xs text-thumb-sub px-4 text-center line-clamp-2 absolute bottom-4 w-full opacity-60">{item.prompt}</p>
                                        <button
                                            onClick={() => cancelQueueItem(item.id)}
                                            className="absolute top-2 right-2 p-1 text-thumb-sub hover:text-red-400 transition-colors"
                                            title="Cancel"
                                        >
                                            <IconX />
                                        </button>
                                    </>
                                )}
                             </div>
                        ))}

                        {/* Generated Images */}
                        {generatedImages.map((img, index) => (
                            <div
                                key={img.id}
                                className="relative group rounded-xl overflow-hidden bg-thumb-card border border-thumb-line aspect-square flex items-center justify-center animate-fade-in-up"
                                style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
                            >
                                {/* Shimmer placeholder — sits behind the image so there's no white flash while it loads. Removed once loaded so it never shimmers through transparent PNGs. */}
                                {!loadedSrcs[img.url] && <div className="thumb-skeleton absolute inset-0" aria-hidden />}
                                <SafeImage src={img.url} alt={img.prompt} loading="lazy" className="relative w-full h-full object-cover cursor-pointer img-fade" fallbackClassName="absolute inset-0 w-full h-full" onClick={() => setViewedImage(img.url)} onLoad={() => markLoaded(img.url)} onError={() => { markLoaded(img.url); onBrokenImage?.(img.id, img.url); }} />
                                <div className={`absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex flex-col justify-end p-3 sm:p-4 transition-all duration-300 ${uiVisible ? 'opacity-100 md:opacity-0 md:group-hover:opacity-100' : 'opacity-0 pointer-events-none'}`}>
                                    <p 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            copyPromptFromImage(img.prompt, img.id);
                                        }}
                                        className={`text-xs line-clamp-2 mb-3 font-medium cursor-pointer transition-all ${
                                            copiedPromptId === img.id 
                                                ? 'text-nano-accent' 
                                                : 'text-white/90'
                                        }`}
                                        title="Click to copy prompt"
                                    >
                                        {copiedPromptId === img.id ? '✓ Copied!' : img.prompt}
                                    </p>
                                    <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                                         <button onClick={() => setViewedImage(img.url)} className="px-2 py-2.5 bg-white/10 backdrop-blur-md text-white text-xs font-bold rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors" title="View Fullscreen"><IconEye /></button>
                                        <button onClick={() => handleBrushSelect(img.url)} className="px-2 py-2.5 bg-white/10 backdrop-blur-md text-white text-xs font-bold rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors" title="Brush Edit">🖌️</button>
                                        <button onClick={() => addToLayers(img.url)} className="px-2 py-2.5 bg-nano-accent text-white text-xs font-bold rounded-lg hover:bg-nano-accentHover flex items-center justify-center transition-colors" title="Add Layer"><IconLayerPlus /></button>
                                        <button onClick={() => downloadImage(img.url)} className="px-2 py-2.5 bg-white/10 backdrop-blur-md text-white text-xs font-bold rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors" title="Download"><IconDownload /></button>
                                        <button onClick={() => deleteGeneratedImage(img.id)} className="px-2 py-2.5 bg-red-500/80 backdrop-blur-md text-white text-xs font-bold rounded-lg hover:bg-red-500 flex items-center justify-center transition-colors" title="Delete"><IconTrash /></button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
        </div>

      <div className={`hidden lg:block order-1 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto no-scrollbar transition-opacity duration-300 ${uiVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="thumb-glass p-4 sm:p-5 rounded-3xl flex flex-col gap-4">

          {/* Brand + back — desktop keeps this inside the sidebar (no top header). */}
          <div className="flex items-center gap-2.5">
              <button
                onClick={() => setView('studio')}
                title="Back to PodcastFlux"
                className="group w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink hover:border-thumb-red/40 transition-all"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <div className="thumb-btn w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"><IconSparkles /></div>
              <div className="leading-tight">
                <div className="font-extrabold tracking-tight text-[15px] text-thumb-ink">PodcastFlux Editor</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-thumb-sub">Canvas Editor</div>
              </div>
          </div>

          <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-thumb-sub">Prompt</label>
              <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={isImageMode && sourceImages.length > 0 ? "Describe your edit..." : "Describe an image to generate..."}
                  className="w-full min-h-[120px] lg:min-h-[200px] bg-thumb-soft text-thumb-ink placeholder-thumb-sub/60 rounded-2xl px-4 py-3 outline-none border border-thumb-line focus:border-nano-accent/50 transition-all text-sm resize-none"
                  onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && handleGenerate()}
              />
          </div>
          <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className={`thumb-btn w-full py-3.5 rounded-2xl text-white font-black text-[15px] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed ${isProcessing ? 'shadow-[0_0_20px_rgba(255,51,85,0.35)]' : ''}`}
          >
              {isProcessing ? 'Add to queue' : 'Generate'}
              <IconSparkles />
          </button>

          <div className="flex flex-col gap-3">
              <button
                onClick={() => setIsImageMode(!isImageMode)}
                className={`flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all ${isImageMode ? 'thumb-liquid' : 'bg-thumb-soft border-thumb-line text-thumb-sub hover:text-thumb-ink'}`}
              >
                 <span>Image input</span>
                 {isImageMode ? <IconToggleRight /> : <IconToggleLeft />}
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-thumb-sub">Quality</span>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-xl px-3 py-2.5 border border-thumb-line focus-within:border-nano-accent/50 transition-colors">
                          <IconSettings />
                          <select value={settings.resolution} onChange={(e) => setSettings(prev => ({...prev, resolution: e.target.value as any, modelType: (e.target.value === '1K' ? 'flash' : 'pro')}))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              <option value="1K" className="bg-thumb-card text-thumb-ink">Fast</option>
                              <option value="2K" className="bg-thumb-card text-thumb-ink">HD</option>
                              <option value="4K" className="bg-thumb-card text-thumb-ink">4K</option>
                          </select>
                      </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-thumb-sub">Ratio</span>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-xl px-3 py-2.5 border border-thumb-line focus-within:border-nano-accent/50 transition-colors">
                          <IconAspectRatio />
                          <select value={settings.aspectRatio} onChange={(e) => setSettings(prev => ({...prev, aspectRatio: e.target.value}))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              {ASPECT_RATIOS.map(ratio => (<option key={ratio.value} value={ratio.value} className="bg-thumb-card text-thumb-ink">{ratio.label}</option>))}
                          </select>
                      </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-thumb-sub">Style</span>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-xl px-3 py-2.5 border border-thumb-line focus-within:border-nano-accent/50 transition-colors">
                          <IconPalette />
                          <select value={settings.style} onChange={(e) => setSettings(prev => ({...prev, style: e.target.value}))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              {STYLES.map(style => (<option key={style.value} value={style.value} className="bg-thumb-card text-thumb-ink">{style.label}</option>))}
                          </select>
                      </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-thumb-sub">Camera</span>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-xl px-3 py-2.5 border border-thumb-line focus-within:border-nano-accent/50 transition-colors">
                          <IconCamera />
                          <select value={settings.cameraAngle} onChange={(e) => setSettings(prev => ({...prev, cameraAngle: e.target.value}))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              {CAMERA_ANGLES.map(angle => (<option key={angle.value} value={angle.value} className="bg-thumb-card text-thumb-ink">{angle.label}</option>))}
                          </select>
                      </div>
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-thumb-sub">Quick action</span>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-xl px-3 py-2.5 border border-thumb-line focus-within:border-nano-accent/50 transition-colors">
                          <IconSparkles />
                          <select value="" onChange={(e) => { if (e.target.value) { const preset = PRESET_PROMPTS.find(p => p.label === e.target.value); if (preset) { setPrompt(preset.prompt); if (preset.label.includes('BG') && sourceImages.length === 0) { setGlobalError("Upload an image first to change background."); setIsImageMode(true); } } } }} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              <option value="" className="bg-thumb-card text-thumb-ink">Choose…</option>
                              {PRESET_PROMPTS.map(preset => (<option key={preset.label} value={preset.label} className="bg-thumb-card text-thumb-ink">{preset.icon} {preset.label}</option>))}
                          </select>
                      </div>
                  </div>
                  <div className="flex flex-col gap-1.5 col-span-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-thumb-sub">Variations</span>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-xl px-3 py-2.5 border border-thumb-line focus-within:border-nano-accent/50 transition-colors">
                          <IconLayers />
                          <select value={batchCount} onChange={(e) => setBatchCount(parseInt(e.target.value))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              <option value="1" className="bg-thumb-card text-thumb-ink">1× generation</option>
                              <option value="2" className="bg-thumb-card text-thumb-ink">2× generations</option>
                              <option value="3" className="bg-thumb-card text-thumb-ink">3× generations</option>
                              <option value="4" className="bg-thumb-card text-thumb-ink">4× generations</option>
                          </select>
                      </div>
                  </div>
              </div>

              {((isImageMode && sourceImages.length > 0) || generatedImages.length > 0) && (
                  <div className="flex flex-wrap gap-2 pt-3 border-t border-thumb-line">
                      {isImageMode && sourceImages.length > 0 && (
                          <button onClick={handleRemoveBackground} className="flex items-center gap-1.5 bg-thumb-soft hover:bg-thumb-card rounded-xl px-3 py-2 border border-thumb-line text-xs font-semibold text-thumb-sub hover:text-thumb-ink transition-colors" title="Remove Background"><IconEraser /> Remove BG</button>
                      )}
                      {generatedImages.length > 0 && (
                          <button onClick={handleDownloadAll} className="flex items-center gap-1.5 bg-nano-accent/15 hover:bg-nano-accent/25 rounded-xl px-3 py-2 border border-nano-accent/30 text-xs font-bold text-nano-accent transition-colors" title="Download all as ZIP"><IconZip /> Download all</button>
                      )}
                      {generatedImages.length > 0 && (
                          <button onClick={clearAllGeneratedImages} className="flex items-center gap-1.5 bg-thumb-soft hover:bg-red-900/60 rounded-xl px-3 py-2 border border-thumb-line hover:border-red-800 text-xs font-semibold text-thumb-sub hover:text-red-400 transition-colors ml-auto" title="Clear Canvas"><IconTrash /> Clear</button>
                      )}
                  </div>
              )}

              <button onClick={() => setShowHelp(!showHelp)} className="self-start flex items-center gap-2 px-3 py-1.5 border rounded-xl text-xs font-medium bg-thumb-soft border-thumb-line text-thumb-sub hover:text-thumb-ink transition-all" title="Help & Shortcuts (⌘ + /)">? Shortcuts</button>
          </div>
        </div>
      </div>
        </div>
      </main>

      {/* ── Mobile command bar (bottom-docked) — desktop keeps the sidebar above ── */}
      <div className={`lg:hidden fixed bottom-2 left-1/2 -translate-x-1/2 w-full max-w-2xl px-2 z-50 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${uiVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
          <div className="thumb-glass border border-thumb-line p-1.5 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.25)] flex flex-col gap-1.5 max-h-[72vh] overflow-y-auto no-scrollbar">

              {/* Prompt + Generate — always visible */}
              <div className="flex items-center gap-2 p-0.5">
                  <input
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={isImageMode && sourceImages.length > 0 ? "Describe your edit..." : "Describe an image..."}
                      className="flex-1 min-w-0 bg-thumb-soft text-thumb-ink placeholder-thumb-sub/60 rounded-xl px-4 py-3 outline-none border border-thumb-line focus:border-nano-accent/50 transition-all text-sm"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); handleGenerate(); } }}
                  />
                  <button
                      onClick={handleGenerate}
                      disabled={!prompt.trim()}
                      className={`thumb-btn h-12 px-5 shrink-0 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed text-sm whitespace-nowrap ${isProcessing ? 'shadow-[0_0_20px_rgba(255,51,85,0.35)]' : ''}`}
                  >
                      {isProcessing ? 'Queue' : 'Generate'}
                      <IconSparkles />
                  </button>
              </div>

              {/* Show / Hide tools toggle (mobile only; tablet shows tools always) */}
              <button
                  onClick={() => setShowMobileTools(prev => !prev)}
                  className="sm:hidden w-full py-2.5 rounded-xl border border-thumb-line bg-thumb-soft text-thumb-ink text-xs font-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
              >
                  <IconSettings />
                  {showMobileTools ? 'Hide tools' : 'Show tools'}
                  <svg viewBox="0 0 24 24" className={`w-4 h-4 transition-transform duration-300 ${showMobileTools ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
              </button>

              {/* Tools — full current feature set */}
              <div className={`tools-reveal flex-col gap-2.5 px-1 pb-1 ${showMobileTools ? 'expanded' : 'collapsed'}`}>
                  {/* Image toggle + Quality + Ratio */}
                  <div className="flex items-center gap-2 overflow-x-auto no-scrollbar w-full">
                      <button
                        onClick={() => setIsImageMode(!isImageMode)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition-all whitespace-nowrap shrink-0 ${isImageMode ? 'thumb-liquid' : 'bg-thumb-soft border-thumb-line text-thumb-sub'}`}
                      >
                         Image {isImageMode ? <IconToggleRight /> : <IconToggleLeft />}
                      </button>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-lg px-3 py-2 border border-thumb-line shrink-0">
                          <IconSettings />
                          <select value={settings.resolution} onChange={(e) => setSettings(prev => ({...prev, resolution: e.target.value as any, modelType: (e.target.value === '1K' ? 'flash' : 'pro')}))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer">
                              <option value="1K" className="bg-thumb-card text-thumb-ink">Fast</option>
                              <option value="2K" className="bg-thumb-card text-thumb-ink">HD</option>
                              <option value="4K" className="bg-thumb-card text-thumb-ink">4K</option>
                          </select>
                      </div>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-lg px-3 py-2 border border-thumb-line shrink-0">
                          <IconAspectRatio />
                          <select value={settings.aspectRatio} onChange={(e) => setSettings(prev => ({...prev, aspectRatio: e.target.value}))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer">
                              {ASPECT_RATIOS.map(ratio => (<option key={ratio.value} value={ratio.value} className="bg-thumb-card text-thumb-ink">{ratio.label}</option>))}
                          </select>
                      </div>
                  </div>

                  {/* Style / Camera / Quick action / Variations */}
                  <div className="grid grid-cols-2 gap-2">
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-lg px-3 py-2 border border-thumb-line">
                          <IconPalette />
                          <select value={settings.style} onChange={(e) => setSettings(prev => ({...prev, style: e.target.value}))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              {STYLES.map(style => (<option key={style.value} value={style.value} className="bg-thumb-card text-thumb-ink">{style.label}</option>))}
                          </select>
                      </div>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-lg px-3 py-2 border border-thumb-line">
                          <IconCamera />
                          <select value={settings.cameraAngle} onChange={(e) => setSettings(prev => ({...prev, cameraAngle: e.target.value}))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              {CAMERA_ANGLES.map(angle => (<option key={angle.value} value={angle.value} className="bg-thumb-card text-thumb-ink">{angle.label}</option>))}
                          </select>
                      </div>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-lg px-3 py-2 border border-thumb-line">
                          <IconSparkles />
                          <select value="" onChange={(e) => { if (e.target.value) { const preset = PRESET_PROMPTS.find(p => p.label === e.target.value); if (preset) { setPrompt(preset.prompt); if (preset.label.includes('BG') && sourceImages.length === 0) { setGlobalError("Upload an image first to change background."); setIsImageMode(true); } } } }} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              <option value="" className="bg-thumb-card text-thumb-ink">Action…</option>
                              {PRESET_PROMPTS.map(preset => (<option key={preset.label} value={preset.label} className="bg-thumb-card text-thumb-ink">{preset.icon} {preset.label}</option>))}
                          </select>
                      </div>
                      <div className="flex items-center gap-2 bg-thumb-soft rounded-lg px-3 py-2 border border-thumb-line">
                          <IconLayers />
                          <select value={batchCount} onChange={(e) => setBatchCount(parseInt(e.target.value))} className="bg-transparent text-xs font-medium text-thumb-ink outline-none cursor-pointer w-full">
                              <option value="1" className="bg-thumb-card text-thumb-ink">1×</option>
                              <option value="2" className="bg-thumb-card text-thumb-ink">2×</option>
                              <option value="3" className="bg-thumb-card text-thumb-ink">3×</option>
                              <option value="4" className="bg-thumb-card text-thumb-ink">4×</option>
                          </select>
                      </div>
                  </div>

                  {/* Action buttons */}
                  {((isImageMode && sourceImages.length > 0) || generatedImages.length > 0) && (
                      <div className="flex flex-wrap gap-2">
                          {isImageMode && sourceImages.length > 0 && (
                              <button onClick={handleRemoveBackground} className="flex items-center gap-1.5 bg-thumb-soft rounded-lg px-3 py-2 border border-thumb-line text-xs font-semibold text-thumb-sub hover:text-thumb-ink transition-colors"><IconEraser /> Remove BG</button>
                          )}
                          {generatedImages.length > 0 && (
                              <button onClick={handleDownloadAll} className="flex items-center gap-1.5 bg-nano-accent/15 rounded-lg px-3 py-2 border border-nano-accent/30 text-xs font-bold text-nano-accent transition-colors"><IconZip /> Download all</button>
                          )}
                          {generatedImages.length > 0 && (
                              <button onClick={clearAllGeneratedImages} className="flex items-center gap-1.5 bg-thumb-soft rounded-lg px-3 py-2 border border-thumb-line text-xs font-semibold text-thumb-sub hover:text-thumb-red transition-colors ml-auto"><IconTrash /> Clear</button>
                          )}
                      </div>
                  )}

                  <button onClick={() => setShowHelp(!showHelp)} className="self-start flex items-center gap-2 px-3 py-1.5 border rounded-lg text-xs font-medium bg-thumb-soft border-thumb-line text-thumb-sub hover:text-thumb-ink transition-all">? Shortcuts</button>
              </div>
          </div>
      </div>

      {!uiVisible && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] opacity-80 hover:opacity-100 transition-opacity">
              <div 
                  onClick={() => setUiVisible(true)}
                  className="bg-black/80 backdrop-blur-md border border-zinc-700 rounded-full px-4 py-2 shadow-2xl cursor-pointer hover:border-nano-accent transition-colors"
              >
                  <span className="text-xs text-zinc-300 font-medium">Press ⌘ + H to show controls</span>
              </div>
          </div>
      )}

      {/* From-styles picker — choose a ready-made style thumbnail to add as a source layer */}
      {showStylePicker && (
          <div className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowStylePicker(false)}>
              <div className="thumb-glass border border-thumb-line rounded-2xl p-5 w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                      <div>
                          <h3 className="text-base font-black text-thumb-ink">Add from Styles</h3>
                          <p className="text-xs text-thumb-sub mt-0.5">Pick a style to add as a source layer</p>
                      </div>
                      <button onClick={() => setShowStylePicker(false)} className="w-8 h-8 rounded-lg bg-thumb-soft border border-thumb-line text-thumb-sub hover:text-thumb-ink flex items-center justify-center"><IconX /></button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto no-scrollbar pr-1">
                      {styleImages.map((src, i) => (
                          <button
                              key={i}
                              type="button"
                              onClick={() => { addToLayers(src); setShowStylePicker(false); }}
                              className="relative aspect-video rounded-xl overflow-hidden border border-thumb-line hover:border-nano-accent transition-colors group"
                          >
                              {!loadedSrcs[src] && <div className="thumb-skeleton absolute inset-0" aria-hidden />}
                              <img src={src} alt={`Style ${i + 1}`} loading="lazy" className="relative w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" onLoad={() => markLoaded(src)} onError={() => markLoaded(src)} />
                          </button>
                      ))}
                  </div>
              </div>
          </div>
      )}

      {/* Help Panel */}
      {showHelp && uiVisible && (
          <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
              <div className="thumb-glass border border-thumb-line rounded-2xl p-6 max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-thumb-ink">Shortcuts & Help</h3>
                      <button onClick={() => setShowHelp(false)} className="p-1 text-thumb-sub hover:text-thumb-ink"><IconX /></button>
                  </div>
                  <div className="space-y-3 text-sm">
                      <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="space-y-1">
                              <div className="flex justify-between"><span className="text-thumb-sub">Generate</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘↵</kbd></div>
                              <div className="flex justify-between"><span className="text-thumb-sub">Upload</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘U</kbd></div>
                              <div className="flex justify-between"><span className="text-thumb-sub">Save First</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘S</kbd></div>
                              <div className="flex justify-between"><span className="text-thumb-sub">Save All</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘A</kbd></div>
                              <div className="flex justify-between"><span className="text-thumb-sub">Remove BG</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘B</kbd></div>
                          </div>
                          <div className="space-y-1">
                              <div className="flex justify-between"><span className="text-thumb-sub">Toggle Mode</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘I</kbd></div>
                              <div className="flex justify-between"><span className="text-thumb-sub">Show / Hide UI</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘H</kbd></div>
                              <div className="flex justify-between"><span className="text-thumb-sub">Clear Prompt</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘K</kbd></div>
                              <div className="flex justify-between"><span className="text-thumb-sub">Add Layer</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘D</kbd></div>
                              <div className="flex justify-between"><span className="text-thumb-sub">Clear Canvas</span><kbd className="bg-thumb-soft border border-thumb-line px-1.5 py-0.5 rounded text-nano-accent font-bold">⌘⌫</kbd></div>
                          </div>
                      </div>
                      <div className="border-t border-thumb-line pt-3">
                          <h4 className="text-xs font-semibold text-thumb-sub mb-2">Quick Tips</h4>
                          <ul className="text-xs text-thumb-sub space-y-1">
                              <li>• Use Image Mode for editing uploaded photos</li>
                              <li>• Higher resolution = Pro model (better quality)</li>
                              <li>• Drag & drop images to upload</li>
                              <li>• Click images to view fullscreen</li>
                          </ul>
                      </div>
                  </div>
              </div>
          </div>
      )}

      <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
         <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-nano-accent/5 rounded-full blur-[100px]"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/5 rounded-full blur-[100px]"></div>
      </div>

      {viewedImage && (
          <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center p-4" onClick={() => { setViewedImage(null); setBrushMode(false); setSelectedArea(null); }}>
              {/* Top-right exit. In brush mode it's the ONLY top-bar control:
                  a single Cancel button (per request — nothing else up top). */}
              {brushMode ? (
                  <button className="absolute top-4 right-4 z-[130] px-4 py-2 bg-zinc-800/85 hover:bg-zinc-700 rounded-full text-white text-sm font-bold transition-colors backdrop-blur-sm flex items-center gap-1.5" onClick={() => { setViewedImage(null); setBrushMode(false); setSelectedArea(null); }}><IconX /> Cancel</button>
              ) : (
                  <button className="absolute top-4 right-4 z-[120] p-2 bg-zinc-800/80 hover:bg-zinc-700 rounded-full text-white transition-colors backdrop-blur-sm" onClick={() => { setViewedImage(null); setBrushMode(false); setSelectedArea(null); }}><IconX /></button>
              )}

              {/* Editor toolbar — docked to the RIGHT so it never covers the image, and
                  minimizable so you can see the full frame while working. */}
              {brushMode && brushPanelMin && (
                  <button
                      onClick={(e) => { e.stopPropagation(); setBrushPanelMin(false); }}
                      title="Show edit tools"
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-[120] w-12 h-12 rounded-full bg-black/85 backdrop-blur-xl border border-white/15 text-white text-lg shadow-2xl flex items-center justify-center hover:bg-black/95 transition-colors"
                  >🖌️</button>
              )}
              {brushMode && !brushPanelMin && (
                  <div
                      ref={panelRef}
                      className="fixed z-[120] w-[min(80vw,248px)] max-h-[80vh] flex flex-col bg-black/85 backdrop-blur-xl border border-white/15 rounded-2xl p-3 shadow-2xl"
                      style={panelPos ? { left: panelPos.x, top: panelPos.y } : { right: 12, top: '50%', transform: 'translateY(-50%)' }}
                      onClick={e => e.stopPropagation()}
                  >
                      {/* Draggable header — grab this to move the panel to any side.
                          Minimize collapses it; exit is handled by the top Cancel button. */}
                      <div
                          className="flex items-center justify-between mb-3 -mx-1 px-1 py-1 rounded-lg cursor-move touch-none select-none hover:bg-white/5"
                          onPointerDown={onPanelDragStart}
                          onPointerMove={onPanelDragMove}
                          onPointerUp={onPanelDragEnd}
                          onPointerCancel={onPanelDragEnd}
                      >
                          <span className="text-xs font-black text-white/90 tracking-wide flex items-center gap-1.5">
                              <span className="text-white/40 text-sm leading-none">⠿</span> EDIT TOOLS
                          </span>
                          <button onClick={(e) => { e.stopPropagation(); setBrushPanelMin(true); }} title="Minimize" className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg leading-none pb-1">–</button>
                      </div>

                      {/* Tool selection — Brush + Pin only */}
                      <div className="grid grid-cols-2 gap-2">
                          <button onClick={() => setBrushTool('brush')} className={`px-2 py-2.5 rounded-xl text-xs font-bold transition-all ${brushTool === 'brush' ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>🖌️ Brush</button>
                          <button onClick={() => setBrushTool('pin')} className={`px-2 py-2.5 rounded-xl text-xs font-bold transition-all ${brushTool === 'pin' ? 'bg-nano-accent text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}>📍 Pin</button>
                      </div>

                      {/* Tool-specific controls (scrolls if the pin list grows) */}
                      <div className="mt-3 flex-1 overflow-y-auto no-scrollbar">
                          {brushTool === 'brush' && (
                              <div className="space-y-1.5">
                                  <label className="text-[11px] text-zinc-300">Brush size · {brushSize}px</label>
                                  <div className="flex items-center gap-2">
                                      <button
                                          onClick={() => setBrushSize(s => Math.max(2, s - 2))}
                                          disabled={brushSize <= 2}
                                          title="Smaller brush"
                                          className="w-7 h-7 shrink-0 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-lg leading-none flex items-center justify-center"
                                      >−</button>
                                      <input type="range" min="2" max="120" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white" />
                                      <button
                                          onClick={() => setBrushSize(s => Math.min(120, s + 2))}
                                          disabled={brushSize >= 120}
                                          title="Bigger brush"
                                          className="w-7 h-7 shrink-0 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white text-lg leading-none flex items-center justify-center"
                                      >+</button>
                                  </div>
                                  <p className="text-[10px] text-zinc-400 leading-snug pt-1">Paint a white outline over the area you want changed.</p>
                              </div>
                          )}

                          {brushTool === 'pin' && (
                              <div className="space-y-2">
                                  {annotations.length === 0 ? (
                                      <p className="text-[11px] text-zinc-400 bg-white/5 rounded-lg p-2 leading-relaxed">Tap anywhere on the image to drop a pin, then write what you want changed there. Add as many as you like.</p>
                                  ) : (
                                      annotations.map((a, i) => (
                                          <div key={a.id} className="flex items-center gap-2">
                                              <span className="w-5 h-5 shrink-0 rounded-full bg-nano-accent text-white text-[11px] font-black flex items-center justify-center">{i + 1}</span>
                                              <input
                                                  value={a.note}
                                                  onChange={e => { const v = e.target.value; setAnnotations(prev => prev.map(p => p.id === a.id ? { ...p, note: v } : p)); }}
                                                  placeholder="what to change here"
                                                  className="flex-1 min-w-0 bg-white/10 border border-white/15 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-nano-accent"
                                              />
                                              <button onClick={() => setAnnotations(prev => prev.filter(p => p.id !== a.id))} className="w-6 h-6 shrink-0 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-300 text-xs flex items-center justify-center">✕</button>
                                          </div>
                                      ))
                                  )}
                              </div>
                          )}
                      </div>

                      {/* Actions */}
                      <div className="mt-3 flex items-center gap-2">
                          <button onClick={clearBrushSelection} className="px-3 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl transition-all">Clear</button>
                          <button onClick={applyEditorSelection} className="flex-1 px-4 py-2.5 bg-white hover:bg-white/90 text-black text-xs font-black rounded-xl transition-all">Apply</button>
                      </div>
                  </div>
              )}

              {/* Enhanced Zoom & Pan Controls Overlay */}
              <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[120] flex items-center gap-3 p-2 pl-4 pr-4 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-full shadow-2xl transition-all hover:bg-zinc-900" onClick={e => e.stopPropagation()}>
                   <button onClick={handleZoomOut} className="text-zinc-400 hover:text-white transition-colors disabled:opacity-50" disabled={zoom <= 0.5} title="Zoom Out"><IconZoomOut /></button>
                   
                   <input 
                      type="range" 
                      min="0.5" 
                      max="5" 
                      step="0.1" 
                      value={zoom}
                      onChange={(e) => setZoom(parseFloat(e.target.value))}
                      className="w-32 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-nano-accent outline-none hover:bg-zinc-600 transition-colors"
                   />
                   
                   <button onClick={handleZoomIn} className="text-zinc-400 hover:text-white transition-colors disabled:opacity-50" disabled={zoom >= 5} title="Zoom In"><IconZoomIn /></button>
                   
                   <div className="w-px h-4 bg-zinc-700 mx-1"></div>
                   
                   <button onClick={() => { setZoom(1); setPan({x:0,y:0}); }} className="text-xs font-mono text-nano-accent w-[4ch] text-center hover:text-white transition-colors" title="Reset Zoom">
                       {Math.round(zoom * 100)}%
                   </button>
              </div>

              <div
                  className={`w-full h-full overflow-hidden flex items-center justify-center relative select-none ${zoom > 1 && !brushMode ? 'cursor-move' : ''}`}
                  onClick={e => e.stopPropagation()}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  onWheel={handleWheel}
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                  style={{ touchAction: 'none' }}
              >
                 {imageLoadError ? (
                    <div className="flex flex-col items-center justify-center text-zinc-500 gap-2">
                        <IconX />
                        <span>Failed to load image preview</span>
                    </div>
                 ) : (
                  <div className="relative inline-block">
                      <img 
                          key={viewedImage}
                          src={viewedImage} 
                          alt="Full View" 
                          className="origin-center select-none block"
                          style={{
                              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                              maxWidth: '90vw',
                              maxHeight: '80vh',
                              transition: isDragging ? 'none' : 'transform 0.12s cubic-bezier(0.16, 1, 0.3, 1)',
                              willChange: 'transform'
                          }}
                          draggable={false}
                          onError={() => setImageLoadError(true)}
                          onLoad={(e) => {
                              if (brushMode && canvasRef.current) {
                                  const img = e.target as HTMLImageElement;
                                  const canvas = canvasRef.current;
                                  canvas.width = img.naturalWidth;
                                  canvas.height = img.naturalHeight;
                              }
                          }}
                      />
                      {brushMode && (
                          <canvas
                              ref={canvasRef}
                              className={`absolute top-0 left-0 w-full h-full select-none ${brushTool === 'brush' ? 'cursor-none' : 'cursor-crosshair'}`}
                              style={{
                                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                                  transformOrigin: 'center',
                                  transition: isDragging ? 'none' : 'transform 0.12s cubic-bezier(0.16, 1, 0.3, 1)',
                                  willChange: 'transform',
                                  touchAction: 'none',
                                  userSelect: 'none',
                                  WebkitUserSelect: 'none'
                              }}
                              onMouseDown={startDrawing}
                              onMouseMove={draw}
                              onMouseUp={stopDrawing}
                              onMouseLeave={stopDrawing}
                              onTouchStart={startDrawing}
                              onTouchMove={draw}
                              onTouchEnd={stopDrawing}
                              onPointerMove={updateBrushCursor}
                              onPointerEnter={updateBrushCursor}
                              onPointerLeave={() => setBrushCursor(null)}
                          />
                      )}
                      {/* Annotation pins overlay — same transform as the image so pins
                          stay pinned while you zoom/pan. Clickable only with the Pin tool. */}
                      {brushMode && (
                          <div
                              className="absolute top-0 left-0 w-full h-full"
                              style={{
                                  transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
                                  transformOrigin: 'center',
                                  transition: isDragging ? 'none' : 'transform 0.12s cubic-bezier(0.16, 1, 0.3, 1)',
                                  pointerEvents: brushTool === 'pin' ? 'auto' : 'none',
                                  cursor: brushTool === 'pin' ? 'crosshair' : 'default',
                              }}
                              onClick={addAnnotation}
                          >
                              {annotations.map((a, i) => (
                                  <div
                                      key={a.id}
                                      className="absolute -translate-x-1/2 -translate-y-1/2"
                                      style={{ left: `${a.nx * 100}%`, top: `${a.ny * 100}%` }}
                                      onClick={e => e.stopPropagation()}
                                  >
                                      <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-nano-accent text-white text-[11px] font-black shadow-lg ring-2 ring-white/80">
                                          {i + 1}
                                          {brushTool === 'pin' && (
                                              <button
                                                  onClick={e => { e.stopPropagation(); setAnnotations(prev => prev.filter(p => p.id !== a.id)); }}
                                                  className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-black/80 text-white text-[9px] flex items-center justify-center border border-white/40"
                                              >×</button>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
                 )}
              </div>

              {/* Canvas-style brush cursor — a ring that tracks the pointer and matches
                  the exact brush footprint. Rendered at the document level (fixed) with
                  pointer-events:none so it never blocks drawing; hidden off-canvas. */}
              {brushMode && brushTool === 'brush' && brushCursor && (
                  <div
                      className="fixed z-[125] rounded-full pointer-events-none mix-blend-difference"
                      style={{
                          left: brushCursor.x,
                          top: brushCursor.y,
                          width: Math.max(4, brushCursor.d),
                          height: Math.max(4, brushCursor.d),
                          transform: 'translate(-50%, -50%)',
                          border: '2px solid rgba(255,255,255,0.95)',
                          boxShadow: '0 0 0 1px rgba(0,0,0,0.55)',
                      }}
                  />
              )}

              {/* Bottom actions — hidden while editing (brush mode) so nothing sits
                  below the canvas; only shown in the plain image viewer. */}
              {!brushMode && (
                  <div className="absolute bottom-4 right-4 z-[120] flex gap-2 transition-opacity duration-300" onClick={e => e.stopPropagation()}>
                       <button onClick={() => handleViewerRemoveBg(viewedImage!)} className="px-4 py-2 bg-zinc-800 text-zinc-300 text-sm font-medium rounded-lg hover:bg-zinc-700 flex items-center gap-2 transition-colors border border-zinc-700" title="Use to Remove Background"><IconEraser /> Remove BG</button>
                       <button onClick={() => downloadImage(viewedImage!)} className="px-4 py-2 bg-nano-card/80 backdrop-blur text-white text-sm font-bold rounded-lg hover:bg-zinc-700 flex items-center gap-2 transition-colors border border-zinc-700"><IconDownload /> Save</button>
                  </div>
              )}
          </div>
      )}
    </div>
  );
}
