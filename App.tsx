
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { saveToIndexedDB, getFromIndexedDB, saveToLocalStorage, getFromLocalStorage, STORAGE_KEYS } from './services/storageService';
import ThumbnailStudio, { REFERENCE_IMAGES } from './components/ThumbnailStudio';
import SafeImage from './components/SafeImage';
import { supabase } from './services/supabase';
import { fetchUserGenerations } from './services/historyService';
import { useStyleImages } from './services/stylesService';
import { usePersistentState } from './hooks/usePersistentState';
import { useZoomPan } from './hooks/useZoomPan';
import { useImageQueue } from './hooks/useImageQueue';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { EditorSettings, GeneratedImage, QueueItem, ASPECT_RATIOS, RESOLUTIONS, STYLES, CAMERA_ANGLES, PRESET_PROMPTS } from './types';
import { IconUpload, IconSparkles, IconAspectRatio, IconX, IconDownload, IconPalette, IconToggleLeft, IconToggleRight, IconLayers, IconEye, IconLayerPlus, IconZip, IconEraser, IconTrash, IconZoomIn, IconZoomOut, IconSettings, IconCamera } from './components/Icons';
// jszip (~95 KB) is loaded on demand in handleDownloadAll — kept out of the initial bundle.

// The full-screen editor (~760 lines of markup) is split into its own chunk and
// only fetched when a user opens it. We idle-prefetch it below so the switch
// still feels instant.
const EditorView = React.lazy(() => import('./components/EditorView'));

function App() {
  // Lightweight state persisted to LocalStorage (loads synchronously, no flash).
  const [prompt, setPrompt] = usePersistentState('nano_prompt', '');
  const [isImageMode, setIsImageMode] = usePersistentState('nano_is_image_mode', false);
  const [uiVisible, setUiVisible] = usePersistentState('nano_ui_visible', true);
  // Which screen is shown: the thumbnail studio (landing/generator) or the PodcastFlux editor
  const [view, setView] = usePersistentState<'studio' | 'editor'>('nano_view', 'studio');
  // App-wide light/dark theme, shared with the studio via localStorage (views are mutually exclusive)
  const [theme, setTheme] = usePersistentState<'dark' | 'light'>('nano_theme', 'light');
  
  // Settings initialization - Defaulting to 4K/Pro as requested, ensuring all fields exist
  const [settings, setSettings] = useState<EditorSettings>(() => {
      const defaults: EditorSettings = {
        aspectRatio: '16:9',
        resolution: '4K',
        modelType: 'pro',
        style: 'None',
        cameraAngle: 'None'
      };
      const saved = getFromLocalStorage('nano_settings', {});
      return { ...defaults, ...saved };
  });

  // Heavy state (images) initialized empty, loaded async
  const [sourceImages, setSourceImages] = useState<string[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);

  const [isRestoring, setIsRestoring] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [textResponse, setTextResponse] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [isCheckingKey, setIsCheckingKey] = useState(true);

  // Generation queue — parallel processing, per-item timers, cancel/retry.
  const { queue, setQueue, isProcessing, itemTimers, cancelQueueItem, retryQueueItem } = useImageQueue({
    onGenerated: (newImages) => setGeneratedImages(prev => [...newImages, ...prev]),
    onText: (text) => setTextResponse(text),
    onError: (message) => setGlobalError(message),
  });

  // State for Full Screen Image Viewer
  const [viewedImage, setViewedImage] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [batchCount, setBatchCount] = useState(1);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [brushMode, setBrushMode] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushTool, setBrushTool] = useState<'brush' | 'pin'>('brush');
  // Right-side tool panel can be minimized so the full image is visible while editing.
  const [brushPanelMin, setBrushPanelMin] = useState(false);
  // "From styles" picker — pick a ready-made style thumbnail to add as a source layer.
  const [showStylePicker, setShowStylePicker] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Annotation pins (Pin tool): click the image to drop a numbered marker + a note
  // describing the change you want there. Positions are normalized (0..1) to the image.
  const [annotations, setAnnotations] = useState<{ id: string; nx: number; ny: number; note: string }[]>([]);

  // Tracks which image srcs have finished loading, so the shimmer skeleton is
  // removed once the real image paints (otherwise it keeps animating behind
  // transparent PNGs like remove-bg cut-outs).
  const [loadedSrcs, setLoadedSrcs] = useState<Record<string, boolean>>({});
  const markLoaded = (src: string) => setLoadedSrcs(prev => (prev[src] ? prev : { ...prev, [src]: true }));

  // Style pool for the "From styles" picker — DB-backed, bundled fallback.
  const styleImages = useStyleImages(REFERENCE_IMAGES);

  // Fullscreen-viewer zoom & pan (wheel/drag/pinch). Resets when the viewed image changes.
  const {
    zoom, setZoom, pan, setPan, isDragging,
    handleZoomIn, handleZoomOut, handleWheel,
    handleMouseDown, handleMouseMove, handleMouseUp,
    handleTouchStart, handleTouchMove, handleTouchEnd,
  } = useZoomPan(brushMode, viewedImage);

  // Idle-prefetch the editor chunk so opening it feels instant (falls back to a
  // short timer where requestIdleCallback is unavailable, e.g. Safari).
  useEffect(() => {
    const prefetch = () => { import('./components/EditorView'); };
    const ric = (window as any).requestIdleCallback as ((cb: () => void, opts?: any) => number) | undefined;
    const cancel = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
    const id = ric ? ric(prefetch, { timeout: 4000 }) : window.setTimeout(prefetch, 2500);
    return () => { if (ric && cancel) cancel(id); else clearTimeout(id); };
  }, []);

  // Restore heavy state from IndexedDB on mount
  useEffect(() => {
      const restoreState = async () => {
          try {
              const savedSource = await getFromIndexedDB(STORAGE_KEYS.SOURCE_IMAGES);
              if (savedSource) setSourceImages(savedSource);

              const savedGenerated = await getFromIndexedDB(STORAGE_KEYS.GENERATED_IMAGES);
              if (savedGenerated) setGeneratedImages(savedGenerated);
          } catch (e) {
              console.error("Failed to restore app state", e);
          } finally {
              setIsRestoring(false);
          }
      };
      restoreState();
  }, []);

  // Cross-device history: local IndexedDB is per-device, so a fresh device/browser
  // showed no past work. Pull the account's saved thumbnails from Supabase and
  // merge with the local cache (dedup by URL). Runs after the local restore and
  // again on auth changes (sign-in on a new device). Logged-out users get [].
  useEffect(() => {
      if (isRestoring) return;
      let cancelled = false;
      const sync = async () => {
          const remote = await fetchUserGenerations(200);
          if (cancelled || !remote.length) return;
          setGeneratedImages(prev => {
              const seen = new Set(prev.map(i => i.url));
              const merged = [...prev, ...remote.filter(r => !seen.has(r.url))];
              merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
              return merged;
          });
      };
      sync();
      const sub = supabase?.auth.onAuthStateChange(() => { sync(); });
      return () => {
          cancelled = true;
          sub?.data?.subscription?.unsubscribe?.();
      };
  }, [isRestoring]);

  // Persistence Effects
  useEffect(() => {
      saveToLocalStorage('nano_prompt', prompt);
  }, [prompt]);

  useEffect(() => {
      saveToLocalStorage('nano_is_image_mode', isImageMode);
  }, [isImageMode]);

  useEffect(() => {
      saveToLocalStorage('nano_ui_visible', uiVisible);
  }, [uiVisible]);

  useEffect(() => {
      saveToLocalStorage('nano_view', view);
  }, [view]);

  useEffect(() => {
      saveToLocalStorage('nano_settings', settings);
  }, [settings]);

  // Debounce saving images to avoid performance hits on rapid updates
  useEffect(() => {
      if (!isRestoring) {
          const timeoutId = setTimeout(() => {
              saveToIndexedDB(STORAGE_KEYS.SOURCE_IMAGES, sourceImages);
          }, 500);
          return () => clearTimeout(timeoutId);
      }
  }, [sourceImages, isRestoring]);

  useEffect(() => {
      if (!isRestoring) {
          const timeoutId = setTimeout(() => {
              saveToIndexedDB(STORAGE_KEYS.GENERATED_IMAGES, generatedImages);
          }, 500);
          return () => clearTimeout(timeoutId);
      }
  }, [generatedImages, isRestoring]);

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
      try {
        if (window.aistudio && window.aistudio.hasSelectedApiKey) {
          const has = await window.aistudio.hasSelectedApiKey();
          setHasApiKey(has);
        } else {
          setHasApiKey(true);
        }
      } catch (e) {
        console.error("Failed to check API key status", e);
        setHasApiKey(true);
      } finally {
        setIsCheckingKey(false);
      }
    };
    checkKey();
  }, []);

  // Auto-dismiss error after 6 seconds
  useEffect(() => {
      if (!globalError) return;
      const t = setTimeout(() => setGlobalError(null), 6000);
      return () => clearTimeout(t);
  }, [globalError]);


  const handleConnectKey = async () => {
    if (window.aistudio) {
        try {
            await window.aistudio.openSelectKey();
            setHasApiKey(true);
        } catch (e) {
            console.error("Key selection failed", e);
        }
    }
  };

  // Reset zoom and pan when image changes or viewer opens
  useEffect(() => {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setImageLoadError(false);
  }, [viewedImage]);

  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to find closest aspect ratio
  const detectAspectRatio = (width: number, height: number) => {
      const ratio = width / height;
      const ratios = {
          '1:1': 1,
          '3:4': 0.75,
          '4:3': 1.33,
          '9:16': 0.5625,
          '16:9': 1.7778
      };
      
      let closest = '16:9';
      let minDiff = Infinity;
      
      Object.entries(ratios).forEach(([key, val]) => {
          const diff = Math.abs(ratio - val);
          if (diff < minDiff) {
              minDiff = diff;
              closest = key;
          }
      });
      return closest;
  };

  // Handle File Upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      processFiles(Array.from(files));
    }
  };

  const processFiles = (files: File[]) => {
      const newImages: string[] = [];
      let processedCount = 0;

      files.forEach(file => {
          if (file.type.startsWith('image/')) {
              const reader = new FileReader();
              reader.onload = (e) => {
                  if (e.target?.result) {
                      const resultStr = e.target.result as string;
                      newImages.push(resultStr);
                      
                      // Detect Aspect Ratio from the first image added
                      if (processedCount === 0) {
                          const img = new Image();
                          img.onload = () => {
                              const detectedRatio = detectAspectRatio(img.width, img.height);
                              setSettings(prev => ({ ...prev, aspectRatio: detectedRatio }));
                          };
                          img.src = resultStr;
                      }
                  }
                  processedCount++;
                  if (processedCount === files.length) {
                      setSourceImages(prev => [...prev, ...newImages]);
                      setGlobalError(null);
                      setIsImageMode(true);
                  }
              };
              reader.readAsDataURL(file);
          } else {
              processedCount++;
          }
      });
  };

  const triggerFileUpload = () => {
    fileInputRef.current?.click();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
        processFiles(Array.from(files));
    }
  };

  const addToQueue = useCallback((currentPrompt: string, overrideSettings?: Partial<EditorSettings>) => {
      if (!currentPrompt.trim()) return;

      const effectiveSettings = { ...settings, ...overrideSettings };
      
      // Determine if we should include source images based on mode and availability
      // IMPORTANT: We copy the array so if the user changes sources later, this request is unaffected
      const requestSourceImages = isImageMode ? [...sourceImages] : [];

      const newItem: QueueItem = {
          id: crypto.randomUUID(),
          prompt: currentPrompt,
          settings: effectiveSettings,
          sourceImages: requestSourceImages,
          status: 'pending',
          timestamp: Date.now()
      };

      setQueue(prev => [...prev, newItem]);
      
      // Clear prompt if it was a manual entry (not a preset button click)
      if (!overrideSettings) {
          setPrompt("");
      }
  }, [settings, isImageMode, sourceImages]);

  const handleGenerate = useCallback(() => {
    // Generate based on batch count setting
    for (let i = 0; i < batchCount; i++) {
      setTimeout(() => addToQueue(prompt), i * 100);
    }
    setShowMobileTools(false);
  }, [prompt, addToQueue, batchCount]);

  // ── Thumbnail Studio bridge ──────────────────────────────────────
  // Generate straight into the shared queue, forcing 16:9 HD (Pro) output.
  const handleStudioGenerate = useCallback((studioPrompt: string, sources: string[], opts?: { count?: number; modelType?: 'flash' | 'pro'; aspect?: string }) => {
      if (!studioPrompt.trim()) return;
      const modelType = opts?.modelType ?? 'flash';
      const count = Math.max(1, Math.min(4, opts?.count ?? 1));
      const effectiveSettings: EditorSettings = {
          ...settings,
          aspectRatio: opts?.aspect === '9:16' ? '9:16' : '16:9',
          modelType,
          resolution: modelType === 'pro' ? '2K' : '1K',
      };
      for (let i = 0; i < count; i++) {
          setTimeout(() => {
              const newItem: QueueItem = {
                  id: crypto.randomUUID(),
                  prompt: studioPrompt,
                  settings: effectiveSettings,
                  sourceImages: sources,
                  status: 'pending',
                  timestamp: Date.now(),
              };
              setQueue(prev => [...prev, newItem]);
          }, i * 100);
      }
  }, [settings]);

  // Send a finished thumbnail into the PodcastFlux editor for fine-tuning.
  const handleOpenEditor = useCallback((url?: string) => {
      if (url) {
          setSourceImages([url]);
          setIsImageMode(true);
          const img = new Image();
          img.onload = () => setSettings(prev => ({ ...prev, aspectRatio: detectAspectRatio(img.width, img.height) }));
          img.src = url;
      }
      setView('editor');
      window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleRemoveBackground = () => {
      if (!isImageMode || sourceImages.length === 0) {
          setGlobalError("Upload an image first to remove background.");
          setIsImageMode(true);
          return;
      }
      // Professional background removal prompt for PNG output
      const bgPrompt = "Create a professional cutout of the main subject from this image with transparent background. Remove all background elements completely while preserving the subject with perfect edge quality. Output as PNG format with transparency.";
      
      // Force Style to None and Model to Pro for better instruction following
      addToQueue(bgPrompt, { style: 'None', modelType: 'pro', resolution: '4K' });
  };
  
  const handleViewerRemoveBg = (imageUrl: string) => {
      setSourceImages([imageUrl]);
      setIsImageMode(true);
      setViewedImage(null);
      
      // Auto-detect ratio for the generated image being used as source
      const img = new Image();
      img.onload = () => {
           const detectedRatio = detectAspectRatio(img.width, img.height);
           setSettings(prev => ({ ...prev, aspectRatio: detectedRatio }));
           
           const bgPrompt = "Create a professional cutout of the main subject from this image with transparent background. Remove all background elements completely while preserving the subject with perfect edge quality. Output as PNG format with transparency.";
           setTimeout(() => addToQueue(bgPrompt, { style: 'None', aspectRatio: detectedRatio, modelType: 'pro', resolution: '4K' }), 100);
      };
      img.src = imageUrl;
  };

  const removeSourceImage = (index: number) => {
    setSourceImages(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllSourceImages = () => {
    setSourceImages([]);
  };

  const deleteGeneratedImage = (id: string) => {
      setGeneratedImages(prev => prev.filter(img => img.id !== id));
      if (viewedImage) setViewedImage(null);
  };

  // Self-heal a dead tile: a generated image whose URL 404s (a Storage object
  // the server-side rolling cap deleted, but still referenced by this device's
  // IndexedDB cache) renders as "unavailable". Silently drop it so stale tiles
  // disappear instead of showing the broken placeholder. If the file actually
  // still exists on the server, the next history sync re-adds it. Only prune
  // server-backed http(s) URLs — never local data:/blob: images (those are
  // in-session and a transient decode error shouldn't erase them).
  const handleBrokenImage = (id: string, url: string) => {
      if (/^(data:|blob:)/i.test(url)) return;
      setGeneratedImages(prev => prev.filter(img => img.id !== id));
  };
  
  const clearAllGeneratedImages = () => {
    if (window.confirm('Clear all generated images? This cannot be undone.')) {
      setGeneratedImages([]);
      setTextResponse(null);
    }
  };

  const copyPromptFromImage = (imagePrompt: string, imageId: string) => {
    setPrompt(imagePrompt);
    setCopiedPromptId(imageId);
    setTimeout(() => setCopiedPromptId(null), 2000);
  };

  const handleBrushSelect = (imageUrl: string) => {
    setBrushMode(true);
    setBrushTool('brush');
    setBrushPanelMin(false);
    setAnnotations([]);
    setSelectedArea(imageUrl);
    setViewedImage(imageUrl);
  };

  // Drop an annotation pin at the clicked spot (normalized 0..1 to the image box).
  const addAnnotation = (e: React.MouseEvent<HTMLDivElement>) => {
    if (brushTool !== 'pin') return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    setAnnotations(prev => [...prev, { id: getShortName('pin'), nx, ny, note: '' }]);
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!brushMode || brushTool === 'pin' || !canvasRef.current) return;
    // Stop the browser from turning the drag into a text/page selection.
    if ('preventDefault' in e) e.preventDefault();
    setIsDrawing(true);
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !brushMode || brushTool === 'pin' || !canvasRef.current) return;
    if ('preventDefault' in e) e.preventDefault();

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    const x = (clientX - rect.left) * (canvas.width / rect.width);
    const y = (clientY - rect.top) * (canvas.height / rect.height);
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearBrushSelection = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    setAnnotations([]);
  };

  // Does the mask canvas actually have any drawn selection? (sampled alpha scan)
  const maskHasContent = (): boolean => {
    const c = canvasRef.current;
    if (!c) return false;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    try {
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 3; i < data.length; i += 16) if (data[i] > 10) return true;
    } catch { /* tainted canvas — assume drawn */ return true; }
    return false;
  };

  // Merge the source image with the drawn mask + numbered annotation markers, build a
  // matching edit instruction, and hand it to the main generator.
  const applyEditorSelection = () => {
    const notes = annotations.filter(a => a.note.trim());
    const segs: string[] = [];
    if (maskHasContent()) segs.push('Edit ONLY the white outlined region(s) of the image and leave everything else untouched.');
    if (notes.length) {
      segs.push(
        'The image has numbered red circular markers that are annotations ONLY — do NOT render or keep them in the output. Apply the requested change at each marked location, blending seamlessly and keeping the rest of the image unchanged: ' +
        notes.map((a, i) => `(${i + 1}) ${a.note.trim()}`).join('; ') + '.'
      );
    }
    const editPrompt = segs.length ? segs.join(' ') : 'Edit the image: ';

    // Snapshot the source + mask NOW, before we tear the editor down. The moment
    // brushMode flips off the <canvas> unmounts and canvasRef goes null, so we
    // must read its pixels synchronously and re-load them as an image later.
    const src = selectedArea;
    const maskUrl = (canvasRef.current && maskHasContent()) ? canvasRef.current.toDataURL('image/png') : null;
    const markers = notes.map((a, i) => ({ nx: a.nx, ny: a.ny, n: i + 1 }));

    // Close the brush editor immediately on Apply — no waiting for the merge.
    setPrompt(editPrompt);
    setIsImageMode(true);
    setBrushMode(false);
    setViewedImage(null);
    setSelectedArea(null);
    setAnnotations([]);

    // Attach the marked-up image (mask outline + numbered position markers burned
    // in) as a LAYER in the panel — replacing the original it was drawn on, or
    // appended if that source is gone — so it's visible and reusable, THEN queue
    // the edit generation from it.
    const commit = (merged: string) => {
      setSourceImages(prev => {
        const withoutSrc = prev.filter(u => u !== src);
        const next = [...withoutSrc, merged];
        return next.length > 4 ? next.slice(next.length - 4) : next;
      });
      setQueue(prev => [...prev, {
        id: crypto.randomUUID(),
        prompt: editPrompt,
        settings: { ...settings },
        sourceImages: [merged],
        status: 'pending',
        timestamp: Date.now(),
      }]);
    };

    if (!src) return;

    const img = new Image();
    img.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      const tctx = tempCanvas.getContext('2d');
      if (!tctx) { commit(src); return; }

      const finish = () => {
        // Burn numbered markers at their positions so the model sees WHERE each
        // note applies (they're annotations only — the prompt says to remove them).
        markers.forEach(({ nx, ny, n }) => {
          const x = nx * img.width;
          const y = ny * img.height;
          const r = Math.max(14, img.width * 0.02);
          tctx.beginPath();
          tctx.arc(x, y, r, 0, Math.PI * 2);
          tctx.fillStyle = 'rgba(255,0,60,0.92)';
          tctx.fill();
          tctx.lineWidth = Math.max(2, r * 0.18);
          tctx.strokeStyle = '#ffffff';
          tctx.stroke();
          tctx.fillStyle = '#ffffff';
          tctx.font = `bold ${Math.round(r * 1.15)}px sans-serif`;
          tctx.textAlign = 'center';
          tctx.textBaseline = 'middle';
          tctx.fillText(String(n), x, y);
        });
        commit(tempCanvas.toDataURL('image/png'));
      };

      tctx.drawImage(img, 0, 0);
      if (maskUrl) {
        const m = new Image();
        m.onload = () => { tctx.drawImage(m, 0, 0); finish(); };
        m.onerror = finish;
        m.src = maskUrl;
      } else {
        finish();
      }
    };
    img.onerror = () => commit(src);
    img.src = src;
  };
  
  // Short filename generator
  const getShortName = (prefix = "img") => {
      return `${prefix}-${Math.floor(Math.random() * 0xFFFFF).toString(16)}`;
  }

  const downloadImage = async (url: string) => {
      if (!url) return;
      const filename = `${getShortName()}.png`;
      try {
          // Fetch → blob so the save works for remote (Supabase Storage) URLs too.
          // A bare <a download> is ignored by browsers for cross-origin hrefs — it
          // just opens the image instead of downloading it.
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      } catch (e) {
          // CORS/network fallback: open in a new tab so the user can save manually.
          console.error("Download failed, opening in new tab", e);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          link.target = '_blank';
          link.rel = 'noopener';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      }
  };

  const handleDownloadAll = async () => {
      if (generatedImages.length === 0) return;

      // Load the zip library only when the user actually exports a batch.
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();

      // Images can be base64 data URLs (dev proxy) or remote Storage URLs
      // (production). Handle both: inline base64 directly, fetch remote as a blob.
      await Promise.all(generatedImages.map(async (img, index) => {
          try {
              const name = `${getShortName('nano')}-${index + 1}.png`;
              if (img.url.startsWith('data:')) {
                  const base64Data = img.url.split(',')[1];
                  if (base64Data) zip.file(name, base64Data, { base64: true });
              } else {
                  const res = await fetch(img.url);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  zip.file(name, await res.blob());
              }
          } catch (e) {
              console.error("Failed to add image to zip", e);
          }
      }));

      try {
          const content = await zip.generateAsync({ type: "blob" });
          const link = document.createElement('a');
          link.href = URL.createObjectURL(content);
          link.download = `nano-batch-${getShortName()}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(link.href), 100);
      } catch (e) {
          console.error("Failed to generate zip", e);
          setGlobalError("Failed to create zip file.");
      }
  };

  const addToLayers = (url: string) => {
      if (sourceImages.length >= 4) {
          setGlobalError("Max 4 layers allowed. Remove some source images to add more.");
          return;
      }
      setSourceImages(prev => [...prev, url]);
      setIsImageMode(true); 
      
      // If it's the first image, update aspect ratio to match
      if (sourceImages.length === 0) {
           const img = new Image();
           img.onload = () => {
               const detectedRatio = detectAspectRatio(img.width, img.height);
               setSettings(prev => ({ ...prev, aspectRatio: detectedRatio }));
           };
           img.src = url;
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  // Global Cmd/Ctrl keyboard shortcuts + fullscreen-viewer zoom keys.
  useKeyboardShortcuts({
    prompt,
    generatedImages,
    viewedImage,
    isImageMode,
    sourceImages,
    handleGenerate,
    setViewedImage,
    clearAllSourceImages,
    setZoom,
    setPan,
    downloadImage,
    setUiVisible,
    triggerFileUpload,
    setIsImageMode,
    handleDownloadAll,
    handleRemoveBackground,
    setPrompt,
    addToLayers,
    clearAllGeneratedImages,
    setShowHelp,
  });


  if (isCheckingKey || isRestoring) {
      return <div className="min-h-screen bg-nano-bg flex items-center justify-center"><div className="w-8 h-8 border-2 border-nano-accent border-t-transparent rounded-full animate-spin"></div></div>;
  }

  if (!hasApiKey) {
    return (
        <div className="min-h-screen bg-nano-bg text-nano-text flex items-center justify-center p-4 font-sans">
            <div className="max-w-md w-full bg-nano-card border border-zinc-800 rounded-2xl p-8 text-center space-y-6 shadow-2xl">
                <div className="w-16 h-16 bg-nano-accent rounded-full flex items-center justify-center text-white font-bold text-3xl mx-auto mb-4 shadow-[0_0_20px_rgba(255,51,85,0.3)]">N</div>
                <h1 className="text-2xl font-bold text-white">PodcastFlux Editor</h1>
                <p className="text-zinc-400">Connect your Google Cloud project to start.</p>
                <button 
                    onClick={handleConnectKey}
                    className="w-full py-3 bg-nano-accent hover:bg-nano-accentHover text-white font-bold rounded-xl transition-all shadow-lg"
                >
                    Connect API Key
                </button>
                <p className="text-xs text-zinc-500 pt-2"><a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="underline hover:text-zinc-300">Billing Information</a></p>
            </div>
        </div>
    );
  }

  // ── Thumbnail Studio screen (default landing / generator) ──
  if (view === 'studio') {
      return (
          <>
              <ThumbnailStudio
                  onGenerate={handleStudioGenerate}
                  generatedImages={generatedImages}
                  queue={queue}
                  isProcessing={isProcessing}
                  itemTimers={itemTimers}
                  onView={setViewedImage}
                  onDownload={downloadImage}
                  onDownloadAll={handleDownloadAll}
                  onDelete={deleteGeneratedImage}
                  onBroken={handleBrokenImage}
                  onOpenEditor={handleOpenEditor}
                  onRetry={retryQueueItem}
                  onCancel={cancelQueueItem}
              />
              {/* Lightweight lightbox for the studio (advanced zoom/brush lives in the editor) */}
              {viewedImage && (
                  <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setViewedImage(null)}>
                      <button className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white" onClick={() => setViewedImage(null)}><IconX /></button>
                      <SafeImage src={viewedImage} alt="Thumbnail" className="max-w-[92vw] max-h-[82vh] rounded-2xl shadow-2xl object-contain" fallbackClassName="w-72 h-44 rounded-2xl" onClick={e => e.stopPropagation()} />
                      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex items-center gap-2.5" onClick={e => e.stopPropagation()}>
                          <button onClick={() => handleOpenEditor(viewedImage)} className="flex-1 h-12 px-4 bg-white text-black text-sm font-bold rounded-full hover:bg-zinc-100 transition-colors flex items-center justify-center gap-2 whitespace-nowrap shadow-lg"><IconLayerPlus /> Edit</button>
                          <button onClick={() => downloadImage(viewedImage!)} className="flex-1 h-12 px-4 bg-[#f5334c] text-white text-sm font-bold rounded-full hover:brightness-110 transition-all flex items-center justify-center gap-2 whitespace-nowrap shadow-lg"><IconDownload /> Download</button>
                      </div>
                  </div>
              )}
          </>
      );
  }

  return (
    <React.Suspense fallback={<div className="thumb-scope min-h-screen bg-thumb-bg" />}>
      <EditorView
        theme={theme}
        uiVisible={uiVisible}
        setUiVisible={setUiVisible}
        setView={setView}
        isImageMode={isImageMode}
        setIsImageMode={setIsImageMode}
        sourceImages={sourceImages}
        clearAllSourceImages={clearAllSourceImages}
        triggerFileUpload={triggerFileUpload}
        handleDragOver={handleDragOver}
        handleDrop={handleDrop}
        fileInputRef={fileInputRef}
        handleFileUpload={handleFileUpload}
        styleImages={styleImages}
        showStylePicker={showStylePicker}
        setShowStylePicker={setShowStylePicker}
        removeSourceImage={removeSourceImage}
        viewedImage={viewedImage}
        setViewedImage={setViewedImage}
        textResponse={textResponse}
        setTextResponse={setTextResponse}
        globalError={globalError}
        setGlobalError={setGlobalError}
        generatedImages={generatedImages}
        queue={queue}
        itemTimers={itemTimers}
        isProcessing={isProcessing}
        retryQueueItem={retryQueueItem}
        cancelQueueItem={cancelQueueItem}
        loadedSrcs={loadedSrcs}
        markLoaded={markLoaded}
        copyPromptFromImage={copyPromptFromImage}
        copiedPromptId={copiedPromptId}
        handleBrushSelect={handleBrushSelect}
        addToLayers={addToLayers}
        downloadImage={downloadImage}
        deleteGeneratedImage={deleteGeneratedImage}
        onBrokenImage={handleBrokenImage}
        prompt={prompt}
        setPrompt={setPrompt}
        handleGenerate={handleGenerate}
        settings={settings}
        setSettings={setSettings}
        batchCount={batchCount}
        setBatchCount={setBatchCount}
        handleRemoveBackground={handleRemoveBackground}
        handleDownloadAll={handleDownloadAll}
        clearAllGeneratedImages={clearAllGeneratedImages}
        showHelp={showHelp}
        setShowHelp={setShowHelp}
        showMobileTools={showMobileTools}
        setShowMobileTools={setShowMobileTools}
        brushMode={brushMode}
        setBrushMode={setBrushMode}
        brushPanelMin={brushPanelMin}
        setBrushPanelMin={setBrushPanelMin}
        brushTool={brushTool}
        setBrushTool={setBrushTool}
        brushSize={brushSize}
        setBrushSize={setBrushSize}
        annotations={annotations}
        setAnnotations={setAnnotations}
        clearBrushSelection={clearBrushSelection}
        applyEditorSelection={applyEditorSelection}
        zoom={zoom}
        setZoom={setZoom}
        pan={pan}
        setPan={setPan}
        isDragging={isDragging}
        handleZoomOut={handleZoomOut}
        handleZoomIn={handleZoomIn}
        handleMouseDown={handleMouseDown}
        handleMouseMove={handleMouseMove}
        handleMouseUp={handleMouseUp}
        handleWheel={handleWheel}
        handleTouchStart={handleTouchStart}
        handleTouchMove={handleTouchMove}
        handleTouchEnd={handleTouchEnd}
        imageLoadError={imageLoadError}
        setImageLoadError={setImageLoadError}
        canvasRef={canvasRef}
        startDrawing={startDrawing}
        draw={draw}
        stopDrawing={stopDrawing}
        addAnnotation={addAnnotation}
        setSelectedArea={setSelectedArea}
        handleViewerRemoveBg={handleViewerRemoveBg}
      />
    </React.Suspense>
  );
}

export default App;
