// A tab left open across a deploy still runs the old build, whose code files (hashed names) are gone from the
// server — the next part it loads fails ("Failed to fetch dynamically imported module"). User-reported as a
// "Something went wrong" screen, e.g. right after logging out. The cure is simply loading the new build.

const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading (CSS )?chunk \d+ failed|Unable to preload CSS/i;

export const isStaleBuildError = (err: unknown): boolean =>
  CHUNK_ERROR.test(String((err as any)?.message ?? err ?? ''));

const KEY = 'pf_reloaded_for_build';

/** Reloads the page once to pick up the new build; false if it already just did (so it can't loop). */
export const reloadForNewBuild = (): boolean => {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch { /* private mode: reload anyway */ }
  window.location.reload();
  return true;
};
