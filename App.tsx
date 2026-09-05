
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { saveToIndexedDB, getFromIndexedDB, saveToLocalStorage, getFromLocalStorage, STORAGE_KEYS } from './services/storageService';
import ThumbnailStudio, { REFERENCE_IMAGES } from './components/ThumbnailStudio';
import { useStyleImages } from './services/stylesService';
import { useAuth } from './contexts/AuthContext';
import { supabase, isSupabaseConfigured } from './services/supabase';
import { usePersistentState } from './hooks/usePersistentState';
import { useZoomPan } from './hooks/useZoomPan';
import { useImageQueue } from './hooks/useImageQueue';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { deleteGenerationOnServer } from './services/geminiService';
import { EditorSettings, GeneratedImage, QueueItem, ASPECT_RATIOS, RESOLUTIONS, STYLES, CAMERA_ANGLES, PRESET_PROMPTS } from './types';
import { IconUpload, IconSparkles, IconAspectRatio, IconX, IconDownload, IconPalette, IconToggleLeft, IconToggleRight, IconLayers, IconEye, IconLayerPlus, IconZip, IconEraser, IconTrash, IconZoomIn, IconZoomOut, IconSettings, IconCamera } from './components/Icons';
import RetryImage from './components/RetryImage';
import ConfirmModal from './components/ConfirmModal';
import { I as ThumbI } from './components/ThumbIcons';
// jszip (~95 KB) is loaded on demand in handleDownloadAll — kept out of the initial bundle.

// The full-screen editor (~760 lines of markup) is split into its own chunk and
// only fetched when a user opens it. We idle-prefetch it below so the switch
// still feels instant.
const EditorView = React.lazy(() => import('./components/EditorView'));

function App() {
  // The generated-thumbnails gallery is who the user IS, not what device they're
  // on — the server (generate/index.ts) already persists every result to the
  // "thumbnails" Storage bucket + a `generations` row. Signed in on a second
  // device, IndexedDB there is empty (it never leaves the browser it was
  // written on), so without this, that gallery looks empty even though the
  // account genuinely has thumbnails. See below for the fetch-and-merge.
  const { user, ready: authReady } = useAuth();
  // The gallery's LOCAL cache is scoped per signed-in user (a shared "guest"
  // key while signed out) — otherwise a second account signing in on the same
  // browser would see the first account's cached thumbnails, both before
  // server hydration overwrites them and permanently if it's ever offline.
  const galleryKey = user ? `${STORAGE_KEYS.GENERATED_IMAGES}:${user.id}` : STORAGE_KEYS.GENERATED_IMAGES;

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
    // Capped to match the server's own rolling cleanup (MAX_THUMBNAILS_PER_USER
    // in the "generate" Edge Function, default 200) — without this, the local
    // IndexedDB history grows forever (never pruned client-side), well past
    // what the server actually still has in Storage.
    onGenerated: (newImages) => setGeneratedImages(prev => [...newImages, ...prev].slice(0, 200)),
    onText: (text) => setTextResponse(text),
    onError: (message) => setGlobalError(message),
  });

  // State for Full Screen Image Viewer
  const [viewedImage, setViewedImage] = useState<string | null>(null);
  // "Change face" target — lifted here (rather than local to ThumbnailStudio)
  // so the Studio's own lightbox below can offer it too, not just the
  // per-card button in the results grid. ThumbnailStudio still owns
  // ChangeFaceModal itself and the actual apply logic (it needs the
  // generation-queueing context that lives there); this is just the shared
  // "which image is being face-swapped right now" state.
  const [changeFaceTarget, setChangeFaceTarget] = useState<string | null>(null);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showMobileTools, setShowMobileTools] = useState(false);
  const [batchCount, setBatchCount] = useState(1);
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
  const [brushMode, setBrushMode] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  // What to change in the brushed (masked) region — same idea as a pin's note,
  // but for the brush tool, which paints one region rather than dropping
  // numbered points. Without this the brush tool had no way to say WHAT to do
  // to the marked area, only THAT an area was marked.
  const [brushNote, setBrushNote] = useState('');
  const [selectedArea, setSelectedArea] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushTool, setBrushTool] = useState<'brush' | 'pin'>('brush');
  // Right-side tool panel can be minimized so the full image is visible while editing.
  const [brushPanelMin, setBrushPanelMin] = useState(false);
  // Failsafe: if brush mode closes mid-stroke (e.g. Cancel while dragging),
  // never leave the page's text-selection locked off.
  useEffect(() => {
    if (!brushMode) {
      document.body.style.userSelect = '';
      (document.body.style as any).webkitUserSelect = '';
      setBrushNote('');
    }
  }, [brushMode]);
  // Natural (unscaled) size of the lightbox's <img>, captured on every load —
  // see the effect below for why this is needed on top of the img's own
  // onLoad handler.
  const viewedImgNaturalRef = useRef<{ w: number; h: number } | null>(null);
  // The lightbox <img> only fires onLoad once per `viewedImage`. Turning on
  // brush mode via "Brush out" on an image that's already open (the common
  // path — see startRemoveMode) doesn't remount or reload that <img>, so its
  // onLoad-driven canvas resize (below, in the RetryImage onLoad prop) never
  // runs, and the mask canvas is left at the browser's default 300x150
  // internal resolution while CSS stretches it to the full displayed image.
  // Strokes still look right on screen, but applyRemoveSelection's
  // `drawImage(canvasRef.current, 0, 0)` then draws that 300x150 canvas at
  // native size into the corner of the full-resolution merge — the mask ends
  // up covering an unrelated sliver of the image instead of where the user
  // painted. Re-sync explicitly whenever brush mode turns on, using the size
  // captured from the last successful image load.
  useEffect(() => {
    if (brushMode && canvasRef.current && viewedImgNaturalRef.current) {
      canvasRef.current.width = viewedImgNaturalRef.current.w;
      canvasRef.current.height = viewedImgNaturalRef.current.h;
    }
  }, [brushMode]);
  // "From styles" picker — pick a ready-made style thumbnail to add as a source layer.
  const [showStylePicker, setShowStylePicker] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // URLs deleted this session — checked by the gallery-restore effect below so
  // a server hydration query already in flight when a delete happens can't
  // resurrect it (the query only knows what was true when it started; without
  // this, its merge would see the just-deleted url as "not seen locally" and
  // add it right back).
  const deletedUrlsRef = useRef<Set<string>>(new Set());
  // Annotation pins (Pin tool): click the image to drop a numbered marker + a note
  // describing the change you want there. Positions are normalized (0..1) to the image.
  const [annotations, setAnnotations] = useState<{ id: string; nx: number; ny: number; note: string }[]>([]);

  // Style pool for the "From styles" picker — DB-backed, bundled fallback.
  // Only hits Supabase once the picker is actually opened (showStylePicker),
  // not on every editor load — most sessions never open it.
  const styleImages = useStyleImages(REFERENCE_IMAGES, showStylePicker);

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

  // Source images (in-progress editor state) are always local-only, independent of login.
  //
  // A prior version of the brush/pin Apply flow persisted its internal
  // [original, marked] editor snapshots into sourceImages, so anyone who
  // used that flow before the fix has them stuck in IndexedDB, restored
  // forever as if they were Input Layers the user actually added. They're
  // structurally identical to a real uploaded image (also a plain PNG data
  // URL) — nothing to detect after the fact — so bump a schema version
  // instead: the first load after this fix wipes the (purely transient,
  // in-progress) saved layers once rather than trying to cherry-pick which
  // entries were legacy snapshots.
  const SOURCE_IMAGES_SCHEMA_VERSION = '2';
  useEffect(() => {
      let alive = true;
      (async () => {
          try {
              const seenVersion = getFromLocalStorage('nano_source_images_schema', null);
              if (seenVersion !== SOURCE_IMAGES_SCHEMA_VERSION) {
                  saveToLocalStorage('nano_source_images_schema', SOURCE_IMAGES_SCHEMA_VERSION);
                  await saveToIndexedDB(STORAGE_KEYS.SOURCE_IMAGES, []);
                  return;
              }
              const savedSource = await getFromIndexedDB(STORAGE_KEYS.SOURCE_IMAGES);
              if (alive && savedSource) setSourceImages(savedSource);
          } catch (e) {
              console.error("Failed to restore source images", e);
          }
      })();
      return () => { alive = false; };
  }, []);

  // Generated-thumbnails gallery. Waits for auth's initial check (`authReady`)
  // so it restores under the correct key on first paint instead of the guest
  // key for an instant before a signed-in user resolves. Runs again on every
  // later sign-in/out too. Loads the LOCAL cache for the (now-current)
  // `galleryKey` first — REPLACING whatever was showing, since a different
  // identity means a different gallery, not more of the same one — then
  // merges in the server's copy on top in the SAME effect run (not a second,
  // independently-scheduled effect) so there's no window for a slower local
  // restore to overwrite a faster server merge or vice versa.
  useEffect(() => {
      if (!authReady) return;
      let alive = true;
      (async () => {
          try {
              const saved = await getFromIndexedDB(galleryKey);
              if (alive) setGeneratedImages(saved || []);
          } catch (e) {
              console.error("Failed to restore gallery", e);
          } finally {
              if (alive) setIsRestoring(false);
          }
          if (!alive || !user || !isSupabaseConfigured || !supabase) return;
          const { data, error } = await supabase
              .from('generations')
              .select('id, prompt, path, created_at')
              .order('created_at', { ascending: false })
              .limit(200);
          if (!alive || error || !data) return;
          const serverImages: GeneratedImage[] = data.map((r: any) => ({
              id: `srv-${r.id}`,
              url: supabase!.storage.from('thumbnails').getPublicUrl(r.path).data.publicUrl,
              prompt: r.prompt || '',
              timestamp: new Date(r.created_at).getTime(),
          }));
          setGeneratedImages(prev => {
              const seenUrls = new Set(prev.map(p => p.url));
              const merged = [...prev, ...serverImages.filter(s => !seenUrls.has(s.url) && !deletedUrlsRef.current.has(s.url))];
              merged.sort((a, b) => b.timestamp - a.timestamp);
              return merged.slice(0, 200);
          });
      })();
      return () => { alive = false; };
  }, [authReady, user, galleryKey]);

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
              saveToIndexedDB(galleryKey, generatedImages);
          }, 500);
          return () => clearTimeout(timeoutId);
      }
  }, [generatedImages, isRestoring, galleryKey]);

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
  const handleStudioGenerate = useCallback((studioPrompt: string, sources: string[], opts?: { count?: number; modelType?: 'flash' | 'pro'; aspect?: string; sourceMode?: 'youtube' }) => {
      if (!studioPrompt.trim()) return;
      const modelType = opts?.modelType ?? 'flash';
      const count = Math.max(1, Math.min(4, opts?.count ?? 1));
      const effectiveSettings: EditorSettings = {
          ...settings,
          aspectRatio: opts?.aspect === '9:16' ? '9:16' : '16:9',
          modelType,
          resolution: modelType === 'pro' ? '2K' : '1K',
          sourceMode: opts?.sourceMode,
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

  // Native window.confirm() looks jarring next to the app's own UI and can't
  // be themed — confirmModal drives a styled stand-in instead (see
  // ConfirmModal). Holds the action to run if the user confirms; null means
  // no dialog is open.
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const performDeleteImage = (id: string) => {
      const target = generatedImages.find(img => img.id === id);
      setGeneratedImages(prev => prev.filter(img => img.id !== id));
      if (viewedImage) setViewedImage(null);
      if (target) {
        // Tombstone first — a gallery-restore hydration already in flight
        // when this runs only knows what was locally present when IT started,
        // so without this it could still merge the just-deleted url back in.
        deletedUrlsRef.current.add(target.url);
        // Best-effort server-side cleanup so it doesn't come back on refresh
        // (see deleteGenerationOnServer) — local state above is already
        // updated regardless of whether this succeeds.
        deleteGenerationOnServer(target.url);
      }
  };

  const deleteGeneratedImage = (id: string) => {
      setConfirmModal({
        title: 'Delete thumbnail?',
        message: 'This cannot be undone.',
        onConfirm: () => { performDeleteImage(id); setConfirmModal(null); },
      });
  };

  const performClearAllImages = () => {
    const toDelete = generatedImages;
    setGeneratedImages([]);
    setTextResponse(null);
    toDelete.forEach(img => {
      deletedUrlsRef.current.add(img.url);
      deleteGenerationOnServer(img.url);
    });
  };

  const clearAllGeneratedImages = () => {
    setConfirmModal({
      title: 'Clear all generated images?',
      message: 'This cannot be undone.',
      onConfirm: () => { performClearAllImages(); setConfirmModal(null); },
    });
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

  // Quick brush tool for the studio's lightweight lightbox — deliberately NOT
  // the full nano-editor brush (no Pin tool, minimize panel, etc.): paint over
  // a part of the image, optionally say what to do with it, then Apply.
  // Reuses the same canvas/draw machinery as the editor's brush
  // (brushMode/brushTool/canvasRef/brushNote), just with its own minimal UI.
  // Leaving the instruction blank defaults to removing the marked part.
  const startRemoveMode = () => {
    if (!viewedImage) return;
    setBrushTool('brush');
    setAnnotations([]);
    setSelectedArea(viewedImage);
    setBrushMode(true);
  };

  const cancelRemoveMode = () => {
    clearBrushSelection();
    setBrushMode(false);
    setSelectedArea(null);
  };

  const applyRemoveSelection = () => {
    if (!maskHasContent() || !selectedArea) return;
    const target = selectedArea;
    const instruction = brushNote.trim();
    setIsImageMode(true);
    const img = new Image();
    // See the matching comment in applyEditorSelection — without this, painting
    // a remote (Supabase Storage) image taints the canvas and toDataURL()
    // throws silently, so "Apply" would look like it does nothing.
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let merged = target;
      let plain: string | null = null;
      try {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const tctx = tempCanvas.getContext('2d');
        if (tctx) {
          tctx.drawImage(img, 0, 0);
          plain = snapshotCanvas(tempCanvas);
          if (canvasRef.current) tctx.drawImage(canvasRef.current, 0, 0);
          merged = snapshotCanvas(tempCanvas);
        }
      } catch (err) {
        console.error('applyRemoveSelection merge failed', err);
        setGlobalError('Could not apply that. Please try again.');
        return;
      }
      const editPrompt = instruction
        ? `You are given TWO images of the same photo: the FIRST is the original, unmarked; the SECOND has a white brushed outline marking exactly where to apply the change. Use the SECOND image only to locate where to edit — never render the outline in the output. Edit ONLY the marked region of the FIRST image: ${instruction}. Leave everything else in the image exactly unchanged.`
        : 'You are given TWO images of the same photo: the FIRST is the original, unmarked; the SECOND has a white brushed outline marking exactly what to remove. Use the SECOND image only to locate what to remove — never render the outline in the output. Remove the marked object(s) completely from the FIRST image, filling in the background naturally and seamlessly so the removal is undetectable. Leave everything else in the image exactly unchanged.';
      setQueue(prev => [...prev, {
        id: crypto.randomUUID(),
        prompt: editPrompt,
        settings: { ...settings },
        sourceImages: plain ? [plain, merged] : [merged],
        status: 'pending',
        timestamp: Date.now(),
      }]);
      setBrushMode(false);
      setSelectedArea(null);
      setViewedImage(null);
    };
    img.onerror = () => setGlobalError('Could not load the image. Please try again.');
    img.src = target;
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
    // preventDefault on this handler alone doesn't stop the browser's compat
    // mousedown from still selecting surrounding page text on a fast drag —
    // lock text-selection at the document level for the whole stroke.
    if ('preventDefault' in e) e.preventDefault();
    document.body.style.userSelect = 'none';
    (document.body.style as any).webkitUserSelect = 'none';
    window.getSelection?.()?.removeAllRanges?.();
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
    window.getSelection?.()?.removeAllRanges?.();

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
    document.body.style.userSelect = '';
    (document.body.style as any).webkitUserSelect = '';
  };

  const clearBrushSelection = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    setAnnotations([]);
    setBrushNote('');
  };

  // Does the mask canvas actually have any drawn selection? (sampled alpha scan)
  const maskHasContent = (): boolean => {
    const c = canvasRef.current;
    if (!c) return false;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    try {
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 3; i < data.length; i += 40) if (data[i] > 10) return true;
    } catch { /* tainted canvas — assume drawn */ return true; }
    return false;
  };

  // Reference images sent to the model don't need full source resolution —
  // output quality is controlled separately by settings.resolution/imageSize.
  // A full-res (e.g. 4K) canvas, and especially TWO of them (plain + marked
  // pair below), risk exceeding the image-gen provider's own request-size
  // limits, which shows up here as a generic "all providers failed" — this
  // caps each exported snapshot's longest edge well below that risk while
  // staying more than sharp enough for the model to read a brush outline or
  // pin numbers.
  const MAX_REF_EDGE = 1536;
  const snapshotCanvas = (src: HTMLCanvasElement): string => {
    const scale = Math.min(1, MAX_REF_EDGE / Math.max(src.width, src.height));
    if (scale >= 1) return src.toDataURL('image/png');
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    out.getContext('2d')?.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  };

  // Merge the source image with the drawn mask + numbered annotation markers, build a
  // matching edit instruction, and hand it to the main generator.
  const applyEditorSelection = () => {
    const notes = annotations.filter(a => a.note.trim());
    const hasMask = maskHasContent();
    const hasMarks = hasMask || notes.length > 0;
    const brushInstruction = brushNote.trim();
    const segs: string[] = [];
    if (hasMask) {
      segs.push(
        brushInstruction
          // The user told us exactly what to do in the brushed region — that's
          // the actual instruction now, not a generic "just edit this area".
          ? `Edit ONLY the region outlined in white, leaving everything else unchanged: ${brushInstruction}.`
          : 'Edit ONLY the white outlined region(s) of the image and leave everything else untouched.'
      );
    }
    if (notes.length) {
      segs.push(
        'The image has numbered red circular markers that are annotations ONLY — do NOT render or keep them in the output. Apply the requested change at each marked location, blending seamlessly and keeping the rest of the image unchanged: ' +
        notes.map((a, i) => `(${i + 1}) ${a.note.trim()}`).join('; ') + '.'
      );
    }
    // When anything is marked, the model gets the plain original AND the
    // marked-up version (below) — this guide tells it how to read the pair
    // instead of guessing from the outline/pins alone.
    const guide = hasMarks
      ? 'You are given TWO images of the same photo: the FIRST is the original, unmarked; the SECOND has a white brushed outline and/or numbered red pins marking exactly where to apply the requested change(s). Use the SECOND image only to locate where to edit — never render its outline or pin markers in the output. Produce one edited version of the FIRST image. '
      : '';
    const editPrompt = (guide + (segs.length ? segs.join(' ') : 'Edit the image: ')).trim();
    setIsImageMode(true);

    const merge = () => {
      if (!selectedArea) { setBrushMode(false); setViewedImage(null); return; }
      const img = new Image();
      // selectedArea is almost always a remote (Supabase Storage) URL. Without
      // this, the browser treats the pixels it paints as "tainted" for canvas
      // use even though the <img> displays fine — tempCanvas.toDataURL() below
      // then throws a SecurityError inside this onload handler, which silently
      // aborts before the setQueue/setBrushMode/setViewedImage calls ever run.
      // That's exactly what "Apply does nothing" looked like: no error shown,
      // nothing queued, editor stuck open.
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        let merged = selectedArea;
        let plain: string | null = null;
        try {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = img.width;
          tempCanvas.height = img.height;
          const tctx = tempCanvas.getContext('2d');
          if (tctx) {
            tctx.drawImage(img, 0, 0);
            // Snapshot the plain, unmarked photo BEFORE drawing the mask/pins on
            // top — sent alongside the marked version below so the model has an
            // undistorted view of the original, not just the outlined one.
            if (hasMarks) plain = snapshotCanvas(tempCanvas);
            if (canvasRef.current) tctx.drawImage(canvasRef.current, 0, 0);
            // Burn numbered markers so the model can see WHERE each note applies.
            notes.forEach((a, i) => {
              const x = a.nx * img.width;
              const y = a.ny * img.height;
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
              tctx.fillText(String(i + 1), x, y);
            });
            merged = snapshotCanvas(tempCanvas);
            // Deliberately NOT setSourceImages(...) here — the original/marked
            // pair is only for THIS generation call (passed directly to the
            // queue item below). Surfacing it in the visible "Input Layers"
            // strip would show the internal masked/marked image as if it were
            // a layer the user added, which isn't useful once Apply has
            // already queued the edit — it should stay a background detail.
          }
        } catch (err) {
          console.error('applyEditorSelection merge failed', err);
          setGlobalError('Could not apply your edit. Please try again.');
          return;
        }
        // Apply == generate: enqueue right away using LOCAL values (state updates
        // above won't have flushed yet, so we don't rely on them here).
        setQueue(prev => [...prev, {
          id: crypto.randomUUID(),
          prompt: editPrompt,
          settings: { ...settings },
          sourceImages: plain ? [plain, merged] : [merged],
          status: 'pending',
          timestamp: Date.now(),
        }]);
        // Only clear the visible Prompt box once the edit is actually queued —
        // clearing it earlier (e.g. before image load/canvas export) would lose
        // whatever the user had typed there if that step then failed.
        setPrompt('');
        setBrushMode(false);
        setViewedImage(null);
      };
      img.onerror = () => {
        setGlobalError('Could not load the image to apply your edit. Please try again.');
      };
      img.src = selectedArea;
    };
    merge();
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
                  onOpenEditor={handleOpenEditor}
                  onRetry={retryQueueItem}
                  onCancel={cancelQueueItem}
                  changeFaceTarget={changeFaceTarget}
                  setChangeFaceTarget={setChangeFaceTarget}
              />
              {/* Lightweight lightbox for the studio (the full nano-editor's brush
                  lives in EditorView — this has its own minimal "mark + remove"
                  tool instead, see startRemoveMode/applyRemoveSelection above). */}
              {viewedImage && (
                  <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4" onClick={() => { if (!brushMode) setViewedImage(null); }}>
                      <button className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white" onClick={() => brushMode ? cancelRemoveMode() : setViewedImage(null)}><IconX /></button>

                      {/* Image + (desktop) side rail as ONE centered group. The rail
                          used to be absolutely positioned at a fixed `right-6`,
                          independent of the image's own centering — on any window
                          where the image ended up height-constrained (max-h-[82vh]
                          binding before max-w did) it rendered narrower than its
                          width cap, so the two drifted apart: a dead gap on one
                          side, the rail floating away from (or overlapping) the
                          image's actual edge. Laying them out as flex siblings
                          means they size and center together, every time. */}
                      <div className="flex flex-col lg:flex-row items-center gap-4 lg:gap-6 max-w-full max-h-full" onClick={e => e.stopPropagation()}>
                          <div className="relative inline-block max-w-[92vw] lg:max-w-[64vw] max-h-[82vh] lg:max-h-[85vh]">
                              <RetryImage
                                  key={viewedImage}
                                  url={viewedImage}
                                  alt="Thumbnail"
                                  className="max-w-[92vw] lg:max-w-[64vw] max-h-[82vh] lg:max-h-[85vh] rounded-2xl shadow-2xl object-contain block"
                                  onLoad={e => {
                                      const img = e.target as HTMLImageElement;
                                      viewedImgNaturalRef.current = { w: img.naturalWidth, h: img.naturalHeight };
                                      if (brushMode && canvasRef.current) {
                                          canvasRef.current.width = img.naturalWidth;
                                          canvasRef.current.height = img.naturalHeight;
                                      }
                                  }}
                              />
                              {brushMode && (
                                  <canvas
                                      ref={canvasRef}
                                      className="absolute top-0 left-0 w-full h-full rounded-2xl cursor-crosshair touch-none select-none"
                                      onMouseDown={startDrawing}
                                      onMouseMove={draw}
                                      onMouseUp={stopDrawing}
                                      onMouseLeave={stopDrawing}
                                      onTouchStart={startDrawing}
                                      onTouchMove={draw}
                                      onTouchEnd={stopDrawing}
                                  />
                              )}
                          </div>

                          {/* Desktop rail — in-flow flex sibling now, not absolute. */}
                          {!brushMode ? (
                              <div className="hidden lg:flex w-52 shrink-0 flex-col gap-2.5">
                                  <button onClick={startRemoveMode} className="h-12 px-4 bg-white/10 hover:bg-white/20 text-white rounded-xl flex items-center justify-center gap-2 text-sm font-bold backdrop-blur-sm transition-colors">🖌️ Brush out</button>
                                  <button onClick={() => setChangeFaceTarget(viewedImage)} className="h-12 px-4 bg-white/10 hover:bg-white/20 text-white rounded-xl flex items-center justify-center gap-2 text-sm font-bold backdrop-blur-sm transition-colors"><ThumbI.FaceSwap className="w-4 h-4" /> Change face</button>
                                  <button onClick={() => handleOpenEditor(viewedImage)} className="h-12 px-4 bg-white text-black text-sm font-bold rounded-xl hover:bg-zinc-100 transition-colors flex items-center justify-center gap-2 shadow-lg"><IconLayerPlus /> Edit</button>
                                  <button onClick={() => downloadImage(viewedImage!)} className="h-12 px-4 bg-[#f5334c] text-white text-sm font-bold rounded-xl hover:brightness-110 transition-all flex items-center justify-center gap-2 shadow-lg"><IconDownload /> Download</button>
                              </div>
                          ) : (
                              <div className="hidden lg:flex w-72 shrink-0 flex-col gap-2.5">
                                  <div className="flex items-center gap-2.5 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-xl px-3.5 py-2.5">
                                      <span className="text-[11px] text-zinc-300 font-bold shrink-0">Brush size</span>
                                      <input type="range" min="8" max="80" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white" />
                                  </div>
                                  <input
                                      type="text"
                                      value={brushNote}
                                      onChange={e => setBrushNote(e.target.value)}
                                      placeholder="What to do here… (leave blank to just remove it)"
                                      className="h-12 px-4 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-xl text-white text-sm placeholder-zinc-500 outline-none focus:border-white/40"
                                  />
                                  <div className="flex items-center gap-2.5">
                                      <button onClick={clearBrushSelection} className="h-12 px-5 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-xl transition-colors backdrop-blur-sm">Clear</button>
                                      <button onClick={applyRemoveSelection} className="flex-1 h-12 px-4 bg-[#f5334c] text-white text-sm font-bold rounded-xl hover:brightness-110 transition-all shadow-lg">Apply</button>
                                  </div>
                              </div>
                          )}
                      </div>

                      {/* Mobile/tablet: bottom bar, thumb reach — unaffected by the
                          desktop group above (that rail stays hidden below lg). */}
                      {!brushMode ? (
                          <div className="lg:hidden absolute bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex items-center gap-2.5" onClick={e => e.stopPropagation()}>
                              <button onClick={startRemoveMode} title="Brush out unwanted parts" className="h-12 w-12 shrink-0 bg-white/10 hover:bg-white/20 text-white rounded-xl flex items-center justify-center text-lg backdrop-blur-sm transition-colors">🖌️</button>
                              <button onClick={() => handleOpenEditor(viewedImage)} className="flex-1 h-12 px-4 bg-white text-black text-sm font-bold rounded-xl hover:bg-zinc-100 transition-colors flex items-center justify-center gap-2 whitespace-nowrap shadow-lg"><IconLayerPlus /> Edit</button>
                              <button onClick={() => downloadImage(viewedImage!)} className="flex-1 h-12 px-4 bg-[#f5334c] text-white text-sm font-bold rounded-xl hover:brightness-110 transition-all flex items-center justify-center gap-2 whitespace-nowrap shadow-lg"><IconDownload /> Download</button>
                          </div>
                      ) : (
                          <div className="lg:hidden absolute bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex flex-col gap-2.5" onClick={e => e.stopPropagation()}>
                              <div className="flex items-center gap-2.5 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-xl px-3.5 py-2.5">
                                  <span className="text-[11px] text-zinc-300 font-bold shrink-0">Brush size</span>
                                  <input type="range" min="8" max="80" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="flex-1 h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white" />
                              </div>
                              <input
                                  type="text"
                                  value={brushNote}
                                  onChange={e => setBrushNote(e.target.value)}
                                  placeholder="What to do here… (leave blank to just remove it)"
                                  className="h-12 px-4 bg-zinc-900/90 backdrop-blur-md border border-zinc-700 rounded-xl text-white text-sm placeholder-zinc-500 outline-none focus:border-white/40"
                              />
                              <div className="flex items-center gap-2.5">
                                  <button onClick={clearBrushSelection} className="h-12 px-5 bg-white/10 hover:bg-white/20 text-white text-sm font-bold rounded-xl transition-colors backdrop-blur-sm">Clear</button>
                                  <button onClick={applyRemoveSelection} className="flex-1 h-12 px-4 bg-[#f5334c] text-white text-sm font-bold rounded-xl hover:brightness-110 transition-all shadow-lg">Apply</button>
                              </div>
                          </div>
                      )}
                  </div>
              )}
              <ConfirmModal
                  open={confirmModal !== null}
                  title={confirmModal?.title ?? ''}
                  message={confirmModal?.message ?? ''}
                  onConfirm={() => confirmModal?.onConfirm()}
                  onCancel={() => setConfirmModal(null)}
              />
          </>
      );
  }

  return (
    <>
    <React.Suspense fallback={
      <div className="thumb-scope min-h-screen bg-thumb-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-thumb-red border-t-transparent rounded-full animate-spin" />
      </div>
    }>
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
        copyPromptFromImage={copyPromptFromImage}
        copiedPromptId={copiedPromptId}
        handleBrushSelect={handleBrushSelect}
        addToLayers={addToLayers}
        downloadImage={downloadImage}
        deleteGeneratedImage={deleteGeneratedImage}
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
        brushNote={brushNote}
        setBrushNote={setBrushNote}
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
    <ConfirmModal
        open={confirmModal !== null}
        title={confirmModal?.title ?? ''}
        message={confirmModal?.message ?? ''}
        onConfirm={() => confirmModal?.onConfirm()}
        onCancel={() => setConfirmModal(null)}
    />
    </>
  );
}

export default App;
