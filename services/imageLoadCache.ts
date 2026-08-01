// URLs confirmed to have loaded successfully at least once this session —
// shared across every image-loading surface (Thumbnail Studio's results grid,
// the Nano Editor canvas, its generated/style lists) via a plain module-level
// Set rather than React state, so nothing needs to be threaded through props.
// Effect: once a URL has loaded anywhere, re-mounting it elsewhere (e.g.
// opening a result in the editor) renders it immediately — no repeated
// skeleton flash, no repeated retry sequence for a URL already known-good.
const loadedUrls = new Set<string>();

export const isKnownLoaded = (url: string): boolean => loadedUrls.has(url);
export const markKnownLoaded = (url: string): void => { loadedUrls.add(url); };
