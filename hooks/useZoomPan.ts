import React, { useEffect, useRef, useState } from 'react';

// Fullscreen-viewer zoom & pan: wheel zoom-to-cursor, drag panning, and
// two-finger pinch on touch. Extracted verbatim from App.tsx — behaviour is
// unchanged. `brushMode` disables zoom/pan while painting; `resetKey` (the
// viewed image) resets zoom + pan whenever it changes.
export function useZoomPan(brushMode: boolean, resetKey: unknown) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Refs for pinch zoom
  const initialPinchDistanceRef = useRef<number | null>(null);
  const initialZoomRef = useRef<number>(1);

  // Reset zoom and pan when the viewed image changes / viewer opens.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [resetKey]);

  const handleZoomIn = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom(prev => Math.min(prev + 0.5, 5));
  };

  const handleZoomOut = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoom(prev => Math.max(prev - 0.5, 0.5));
  };

  // Wheel Zoom with Zoom-To-Cursor Logic
  const handleWheel = (e: React.WheelEvent) => {
    if (brushMode) return; // Disable zoom when brush is active

    e.stopPropagation();
    e.preventDefault();

    // Determine zoom direction and factor
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    let newZoom = zoom * factor;
    newZoom = Math.max(0.5, Math.min(newZoom, 5));

    if (Math.abs(newZoom - zoom) < 0.01) return;

    const containerRect = e.currentTarget.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;

    // Mouse position relative to center
    const mouseX = e.clientX - containerRect.left - centerX;
    const mouseY = e.clientY - containerRect.top - centerY;

    // Math: NewPan = Mouse * (1 - NewZoom/OldZoom) + OldPan * (NewZoom/OldZoom)
    const effectiveFactor = newZoom / zoom;

    setPan(prev => ({
      x: mouseX * (1 - effectiveFactor) + prev.x * effectiveFactor,
      y: mouseY * (1 - effectiveFactor) + prev.y * effectiveFactor,
    }));
    setZoom(newZoom);
  };

  // Mouse Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Allow drag if zoomed in and not in brush mode
    if (zoom > 1 && !brushMode) {
      e.preventDefault();
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1 && !brushMode) {
      e.preventDefault();
      setPan({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch Handlers for Mobile (Pan & Pinch)
  const getPinchDistance = (touches: React.TouchList) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation(); // Stop propagation to prevent closing viewer

    if (e.touches.length === 1) {
      if (brushMode) {
        // Single touch for brush in brush mode
        return; // Let brush handler take over
      } else if (zoom > 1) {
        // Single touch pan when not in brush mode
        setIsDragging(true);
        const touch = e.touches[0];
        dragStartRef.current = { x: touch.clientX - pan.x, y: touch.clientY - pan.y };
      }
    } else if (e.touches.length === 2) {
      // Two-finger pinch zoom (works in brush mode too)
      const dist = getPinchDistance(e.touches);
      initialPinchDistanceRef.current = dist;
      initialZoomRef.current = zoom;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();

    if (e.touches.length === 1) {
      if (brushMode) {
        // Single touch for brush - let brush handler take over
        return;
      } else if (isDragging && zoom > 1) {
        // Single touch pan when not in brush mode
        const touch = e.touches[0];
        setPan({
          x: touch.clientX - dragStartRef.current.x,
          y: touch.clientY - dragStartRef.current.y,
        });
      }
    } else if (e.touches.length === 2 && initialPinchDistanceRef.current) {
      // Pinch Zoom Move
      const dist = getPinchDistance(e.touches);
      const scaleFactor = dist / initialPinchDistanceRef.current;
      let newZoom = initialZoomRef.current * scaleFactor;
      newZoom = Math.max(0.5, Math.min(newZoom, 5));
      setZoom(newZoom);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    initialPinchDistanceRef.current = null;
  };

  return {
    zoom,
    setZoom,
    pan,
    setPan,
    isDragging,
    handleZoomIn,
    handleZoomOut,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
  };
}
