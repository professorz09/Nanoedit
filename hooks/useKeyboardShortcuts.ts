import { useEffect } from 'react';
import { GeneratedImage } from '../types';

interface KeyboardShortcutProps {
  prompt: string;
  generatedImages: GeneratedImage[];
  viewedImage: string | null;
  isImageMode: boolean;
  sourceImages: string[];
  handleGenerate: () => void;
  setViewedImage: (v: string | null) => void;
  clearAllSourceImages: () => void;
  setZoom: (updater: (z: number) => number) => void;
  setPan: (p: { x: number; y: number }) => void;
  downloadImage: (url: string) => void;
  setUiVisible: (updater: (v: boolean) => boolean) => void;
  triggerFileUpload: () => void;
  setIsImageMode: (updater: (v: boolean) => boolean) => void;
  handleDownloadAll: () => void;
  handleRemoveBackground: () => void;
  setPrompt: (v: string) => void;
  addToLayers: (url: string) => void;
  clearAllGeneratedImages: () => void;
  setShowHelp: (updater: (v: boolean) => boolean) => void;
}

// Global Cmd/Ctrl-based keyboard shortcuts + fullscreen-viewer zoom keys.
// Extracted verbatim from App.tsx; the dependency array is preserved exactly so
// listener re-binding timing is unchanged.
export function useKeyboardShortcuts(p: KeyboardShortcutProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;   // ⌘ on Mac, Ctrl elsewhere
      const k = e.key.toLowerCase();

      // Escape: close viewer or clear source images (works everywhere)
      if (e.key === 'Escape') {
        if (p.viewedImage) { p.setViewedImage(null); } else { p.clearAllSourceImages(); }
        return;
      }

      // Zoom shortcuts in the fullscreen viewer — no modifier needed.
      // '+'/'=' zoom in, '-'/'_' zoom out, '0' resets. (⌘/Ctrl + these still
      // fall through to the browser, but plain presses drive our viewer.)
      if (p.viewedImage && !typing && !mod) {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); p.setZoom(z => Math.min(+(z + 0.25).toFixed(2), 5)); return; }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); p.setZoom(z => Math.max(+(z - 0.25).toFixed(2), 0.5)); return; }
        if (e.key === '0') { e.preventDefault(); p.setZoom(() => 1); p.setPan({ x: 0, y: 0 }); return; }
      }

      // All shortcuts require Cmd/Ctrl and must never fire while typing
      // (so ⌘C / ⌘A / ⌘V keep working inside the prompt field).
      if (!mod || typing) return;

      switch (k) {
        case 'enter': e.preventDefault(); if (p.prompt.trim()) p.handleGenerate(); break;
        case 's': e.preventDefault(); if (p.generatedImages.length > 0) p.downloadImage(p.generatedImages[0].url); break;
        case 'h': e.preventDefault(); p.setUiVisible(prev => !prev); break;
        case 'u': e.preventDefault(); p.triggerFileUpload(); break;
        case 'i': e.preventDefault(); p.setIsImageMode(prev => !prev); break;
        case 'a': e.preventDefault(); if (p.generatedImages.length > 0) p.handleDownloadAll(); break;
        case 'b': e.preventDefault(); if (p.isImageMode && p.sourceImages.length > 0) p.handleRemoveBackground(); break;
        case 'k': e.preventDefault(); p.setPrompt(''); break;
        case 'd': e.preventDefault(); if (p.generatedImages.length > 0) p.addToLayers(p.generatedImages[0].url); break;
        case 'backspace': e.preventDefault(); if (p.generatedImages.length > 0) p.clearAllGeneratedImages(); break;
        case '/': e.preventDefault(); p.setShowHelp(prev => !prev); break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.handleGenerate, p.prompt, p.generatedImages, p.viewedImage, p.isImageMode, p.sourceImages]);
}
