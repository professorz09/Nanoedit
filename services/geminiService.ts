
import { EditorSettings } from "../types";
import { supabase } from "./supabase";

// Helper to resize base64 image to avoid payload limits (500 errors) and improve speed
export const resizeBase64Image = (base64Str: string, maxWidth = 1024): Promise<string> => {
  return new Promise((resolve) => {
    // If not in browser environment (e.g. SSR), return original
    if (typeof window === 'undefined') {
        resolve(base64Str);
        return;
    }

    // Quick check for length to avoid processing tiny images
    if (base64Str.length < 50000) { // ~37KB
        resolve(base64Str);
        return;
    }

    const img = new Image();
    img.src = base64Str;
    img.crossOrigin = "anonymous"; // Handle potential CORS if url is remote
    
    img.onload = () => {
      // If image is already small enough, return original
      if (img.width <= maxWidth && img.height <= maxWidth) {
        resolve(base64Str);
        return;
      }

      // Calculate new dimensions maintaining aspect ratio
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxWidth) {
          width = Math.round((width * maxWidth) / height);
          height = maxWidth;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        // Export as JPEG with 0.7 quality (balanced for AI input) to reduce size/latency
        const resized = canvas.toDataURL('image/jpeg', 0.7);
        resolve(resized);
      } else {
        resolve(base64Str);
      }
    };
    
    img.onerror = () => {
        // Fallback to original if loading fails
        resolve(base64Str); 
    };
  });
};

/**
 * Edit an image or generate a new one using Gemini 2.5 Flash Image or Gemini 3 Pro Image Preview
 * based on the requested quality/resolution.
 */
export const editImageWithGemini = async (
  base64Images: string[],
  prompt: string,
  settings: EditorSettings
): Promise<{ images: string[], text: string }> => {
  
  // Determine model based on resolution/settings
  // Default to Flash for speed and general editing/generation
  let modelName = 'gemini-2.5-flash-image';
  
  // Upgrade to Pro if high resolution is requested
  const isPro = settings.resolution === '2K' || settings.resolution === '4K' || settings.modelType === 'pro';
  if (isPro) {
    modelName = 'gemini-3-pro-image-preview';
  }

  // Construct the configuration
  // IMPORTANT: aspectRatio is part of imageConfig.
  const config: any = {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: {
      aspectRatio: settings.aspectRatio,
    }
  };

  // imageSize is only supported on the Pro model
  if (modelName === 'gemini-3-pro-image-preview') {
    config.imageConfig.imageSize = settings.resolution;
  }

  // Prepare content parts
  const parts: any[] = [];
  // Full data-URL sources — used by the DEV proxy (keeps the service-account key server-side)
  const sources: string[] = [];

  // If we have images, add them (Edit/Merge Mode)
  // We process them to ensure they aren't too large for the API payload
  if (base64Images && base64Images.length > 0) {
    try {
        // Resize all input images in parallel
        const processedImages = await Promise.all(
            base64Images.map(img => resizeBase64Image(img))
        );

        processedImages.forEach((base64Image) => {
            // Strip header if present to get raw base64 data for inlineData
            const base64Data = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

            // Extract mime type or default to jpeg (since we convert to jpeg in resize)
            const mimeTypeMatch = base64Image.match(/^data:(image\/[a-zA-Z]+);base64,/);
            const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/jpeg';

            sources.push(base64Image.startsWith('data:') ? base64Image : `data:${mimeType};base64,${base64Data}`);
            parts.push({
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            });
        });
    } catch (e) {
        console.warn("Image processing failed, falling back to originals", e);
        // Fallback logic if resize fails
        base64Images.forEach((base64Image) => {
            const base64Data = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
             const mimeTypeMatch = base64Image.match(/^data:(image\/[a-zA-Z]+);base64,/);
            const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';
            parts.push({
              inlineData: {
                data: base64Data,
                mimeType: mimeType,
              },
            });
        });
    }
  }

  // Append style and camera angle modifiers
  let finalPrompt = prompt;
  const modifiers: string[] = [];

  if (settings.style && settings.style !== 'None') {
    modifiers.push(`in ${settings.style} style`);
  }
  
  if (settings.cameraAngle && settings.cameraAngle !== 'None') {
      modifiers.push(`shot from ${settings.cameraAngle}`);
  }

  // We rely on the model's capabilities and the user's specific prompt.
  // Removed forced "highly detailed" etc. to allow for simpler styles if requested.
  // The backend model switch to 'gemini-3-pro-image-preview' handles quality.

  if (modifiers.length > 0) {
      finalPrompt = `${prompt}, ${modifiers.join(', ')}`;
  }

  // Always add the text prompt
  parts.push({ text: finalPrompt });

  // ── DEV: route through the local Vertex proxy ──────────────────────────────
  // In dev the Vite middleware (/api/generate) authenticates to Vertex with the
  // service-account JSON server-side, so the key never reaches the browser.
  if (import.meta.env?.DEV) {
    try {
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: finalPrompt,
          sources,
          aspectRatio: settings.aspectRatio,
          resolution: settings.resolution,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || `Proxy error ${resp.status}`);
      if ((!data.images || !data.images.length) && !data.text) {
        throw new Error('No image generated.');
      }
      return { images: data.images || [], text: data.text || '' };
    } catch (error: any) {
      console.error('Vertex proxy error:', error);
      const errMsg = error?.message || String(error);
      if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
        throw new Error('Could not reach the server. Please try again.');
      }
      if (errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('Publisher model')) {
        throw new Error('That model is unavailable right now. Please try again.');
      }
      if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        throw new Error('Too many requests. Wait a moment and try again.');
      }
      if (errMsg.includes('No image')) {
        throw new Error('No image was generated. Try tweaking your prompt.');
      }
      // Keep the message short & human — never surface raw JSON to the UI.
      throw new Error(errMsg.length > 120 || errMsg.includes('{') ? 'Something went wrong. Please try again.' : errMsg);
    }
  }

  // ── PRODUCTION: secure Supabase Edge Function ──────────────────────────────
  // The function verifies the user, reserves a credit (spend_credit), calls the
  // model with the API key held server-side, saves the image to Storage, and
  // returns public URLs. The image-gen key is NEVER shipped to the browser.
  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supaAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!supaUrl || !supabase) throw new Error("Sign-in is required to generate. Please log in.");

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Please log in to generate.");

  try {
    const resp = await fetch(`${supaUrl}/functions/v1/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supaAnon ?? '',
      },
      body: JSON.stringify({
        prompt: finalPrompt,
        sources,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
      }),
    });
    const data = await resp.json().catch(() => ({}));

    if (resp.status === 402) throw new Error(data?.error || 'No credits left. Please upgrade your plan.');
    if (!resp.ok) throw new Error(data?.error || `Server error ${resp.status}`);
    if ((!data.images || !data.images.length) && !data.text) throw new Error('No image generated.');
    return { images: data.images || [], text: data.text || '' };
  } catch (error: any) {
    const errMsg = error?.message || String(error);
    if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
      throw new Error('Could not reach the server. Please try again.');
    }
    // Pass through clean, human messages (credits / model) but never raw JSON.
    throw new Error(errMsg.length > 140 || errMsg.includes('{') ? 'Something went wrong. Please try again.' : errMsg);
  }
};
