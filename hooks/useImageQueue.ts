import { useEffect, useState } from 'react';
import { editImageWithGemini } from '../services/geminiService';
import { GeneratedImage, QueueItem } from '../types';

interface UseImageQueueCallbacks {
  // Called with the freshly generated images for a completed queue item.
  onGenerated: (images: GeneratedImage[]) => void;
  // Called when the model returns text alongside (or instead of) an image.
  onText: (text: string) => void;
  // Called to surface / clear a global error banner.
  onError: (message: string | null) => void;
}

// Owns the generation queue: parallel processing (max 2), per-item elapsed
// timers, derived isProcessing flag, and cancel/retry. Extracted verbatim from
// App.tsx — the caller keeps `setQueue` to enqueue new work.
export function useImageQueue(callbacks: UseImageQueueCallbacks) {
  const { onGenerated, onText, onError } = callbacks;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  // Per-item processing timers (seconds, 0.1s resolution).
  const [itemTimers, setItemTimers] = useState<Record<string, number>>({});

  // Timer Effect for individual processing items
  useEffect(() => {
    const processingItems = queue.filter(item => item.status === 'processing');

    if (processingItems.length > 0) {
      const interval = setInterval(() => {
        setItemTimers(prev => {
          const updated = { ...prev };
          processingItems.forEach(item => {
            updated[item.id] = (updated[item.id] || 0) + 0.1;
          });
          return updated;
        });
      }, 100);
      return () => clearInterval(interval);
    } else {
      // Clear timers when no items are processing
      setItemTimers({});
    }
  }, [queue]);

  // Queue Processing Logic - Allow parallel processing
  useEffect(() => {
    const processNextItems = async () => {
      // Find pending items (allow up to 2 parallel generations)
      const processingCount = queue.filter(item => item.status === 'processing').length;
      const maxParallel = 2;

      if (processingCount >= maxParallel) return;

      const pendingItems = queue.filter(item => item.status === 'pending').slice(0, maxParallel - processingCount);
      if (pendingItems.length === 0) return;

      // Process each pending item
      pendingItems.forEach(async (nextItem) => {
        onError(null);

        // Update status to processing
        setQueue(prev => prev.map(i => i.id === nextItem.id ? { ...i, status: 'processing' } : i));

        try {
          const { images, text } = await editImageWithGemini(
            nextItem.sourceImages,
            nextItem.prompt,
            nextItem.settings,
          );

          if (images.length > 0) {
            const newImages: GeneratedImage[] = images.map(url => ({
              id: crypto.randomUUID(),
              url,
              prompt: nextItem.prompt,
              timestamp: Date.now(),
              aspect: nextItem.settings.aspectRatio,
            }));
            onGenerated(newImages);
          }

          if (text) {
            onText(text);
          }

          // Remove from queue on success
          setQueue(prev => prev.filter(i => i.id !== nextItem.id));

          // Clear timer for this item
          setItemTimers(prev => {
            const updated = { ...prev };
            delete updated[nextItem.id];
            return updated;
          });
        } catch (err: any) {
          const errorMessage = err.message || 'Failed to generate image.';
          onError(errorMessage);

          // Update queue item to failed
          setQueue(prev => prev.map(i => i.id === nextItem.id ? { ...i, status: 'failed', error: errorMessage } : i));
        }
      });
    };

    processNextItems();
  }, [queue]);

  // Update isProcessing state based on queue
  useEffect(() => {
    const processing = queue.some(item => item.status === 'processing');
    setIsProcessing(processing);
  }, [queue]);

  const cancelQueueItem = (id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id));
  };

  const retryQueueItem = (item: QueueItem) => {
    setQueue(prev => prev.map(i => i.id === item.id ? { ...i, status: 'pending', error: undefined } : i));
  };

  return { queue, setQueue, isProcessing, itemTimers, cancelQueueItem, retryQueueItem };
}
