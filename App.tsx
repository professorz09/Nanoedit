
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { saveToIndexedDB, getFromIndexedDB, saveToLocalStorage, getFromLocalStorage, STORAGE_KEYS } from './services/storageService';
import ThumbnailStudio, { REFERENCE_IMAGES } from './components/ThumbnailStudio';
import { useStyleImages } from './services/stylesService';
import { usePersistentState } from './hooks/usePersistentState';
import { useZoomPan } from './hooks/useZoomPan';
import { useImageQueue } from './hooks/useImageQueue';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { EditorSettings, GeneratedImage, QueueItem, ASPECT_RATIOS, RESOLUTIONS, STYLES, CAMERA_ANGLES, PRESET_PROMPTS } from './types';
import { IconUpload, IconSparkles, IconAspectRatio, IconX, IconDownload, IconPalette, IconToggleLeft, IconToggleRight, IconLayers, IconEye, IconLayerPlus, IconZip, IconEraser, IconTrash, IconZoomIn, IconZoomOut, IconSettings, IconCamera } from './components/Icons';
// @ts-ignore
import JSZip from 'jszip';

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
      for (let i = 3; i < data.length; i += 40) if (data[i] > 10) return true;
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
    setPrompt(editPrompt);
    setIsImageMode(true);

    const merge = () => {
      if (!selectedArea) { setBrushMode(false); setViewedImage(null); return; }
      const img = new Image();
      img.onload = () => {
        let merged = selectedArea;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.width;
        tempCanvas.height = img.height;
        const tctx = tempCanvas.getContext('2d');
        if (tctx) {
          tctx.drawImage(img, 0, 0);
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
          merged = tempCanvas.toDataURL('image/png');
          setSourceImages([merged]);
        }
        // Apply == generate: enqueue right away using LOCAL values (state updates
        // above won't have flushed yet, so we don't rely on them here).
        setQueue(prev => [...prev, {
          id: crypto.randomUUID(),
          prompt: editPrompt,
          settings: { ...settings },
          sourceImages: [merged],
          status: 'pending',
          timestamp: Date.now(),
        }]);
        setBrushMode(false);
        setViewedImage(null);
      };
      img.src = selectedArea;
    };
    merge();
  };
  
  // Short filename generator
  const getShortName = (prefix = "img") => {
      return `${prefix}-${Math.floor(Math.random() * 0xFFFFF).toString(16)}`;
  }

  const downloadImage = (url: string) => {
      const link = document.createElement('a');
      link.href = url;
      link.download = `${getShortName()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleDownloadAll = async () => {
      if (generatedImages.length === 0) return;
      
      const zip = new JSZip();
      
      generatedImages.forEach((img, index) => {
          try {
              // Extract base64 data directly to avoid fetch issues with Data URLs
              const base64Data = img.url.split(',')[1];
              if (base64Data) {
                  zip.file(`${getShortName('nano')}-${index + 1}.png`, base64Data, { base64: true });
              }
          } catch (e) {
              console.error("Failed to add image to zip", e);
          }
      });
      
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
              />
              {/* Lightweight lightbox for the studio (advanced zoom/brush lives in the editor) */}
              {viewedImage && (
                  <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4" onClick={() => setViewedImage(null)}>
                      <button className="absolute top-4 right-4 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white" onClick={() => setViewedImage(null)}><IconX /></button>
                      <img src={viewedImage} alt="Thumbnail" className="max-w-[92vw] max-h-[82vh] rounded-2xl shadow-2xl object-contain" onClick={e => e.stopPropagation()} />
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
                                <img src={img.url} alt={img.prompt} loading="lazy" className="relative w-full h-full object-cover cursor-pointer img-fade" onClick={() => setViewedImage(img.url)} onLoad={() => markLoaded(img.url)} onError={() => markLoaded(img.url)} />
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
              <button className="absolute top-4 right-4 z-[120] p-2 bg-zinc-800/80 hover:bg-zinc-700 rounded-full text-white transition-colors backdrop-blur-sm" onClick={() => { setViewedImage(null); setBrushMode(false); setSelectedArea(null); }}><IconX /></button>

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
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 z-[120] w-[min(80vw,248px)] max-h-[80vh] flex flex-col bg-black/85 backdrop-blur-xl border border-white/15 rounded-2xl p-3 shadow-2xl" onClick={e => e.stopPropagation()}>
                      {/* Header: title + minimize + close */}
                      <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-black text-white/90 tracking-wide">EDIT TOOLS</span>
                          <div className="flex items-center gap-1.5">
                              <button onClick={() => setBrushPanelMin(true)} title="Minimize" className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-lg leading-none pb-1">–</button>
                              <button onClick={() => { setBrushMode(false); setViewedImage(null); }} title="Close editor" className="w-7 h-7 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-xs">✕</button>
                          </div>
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
                                  <input type="range" min="5" max="50" value={brushSize} onChange={e => setBrushSize(parseInt(e.target.value))} className="w-full h-2 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white" />
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
                              className="absolute top-0 left-0 w-full h-full cursor-crosshair select-none"
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

              <div className="absolute bottom-4 right-4 z-[120] flex gap-2 transition-opacity duration-300" onClick={e => e.stopPropagation()}>
                   <button onClick={() => handleViewerRemoveBg(viewedImage!)} className="px-4 py-2 bg-zinc-800 text-zinc-300 text-sm font-medium rounded-lg hover:bg-zinc-700 flex items-center gap-2 transition-colors border border-zinc-700" title="Use to Remove Background"><IconEraser /> Remove BG</button>
                   <button onClick={() => downloadImage(viewedImage!)} className="px-4 py-2 bg-nano-card/80 backdrop-blur text-white text-sm font-bold rounded-lg hover:bg-zinc-700 flex items-center gap-2 transition-colors border border-zinc-700"><IconDownload /> Save</button>
              </div>
          </div>
      )}
    </div>
  );
}

export default App;
