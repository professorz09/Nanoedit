// ═══════════════════════════════════════════════════════════════════════════
// Runs some of the Supabase Edge Functions (supabase/functions/<name>/index.ts) on our own server,
// unchanged, so their keys (Supadata, Google/Vertex, OpenRouter) can live only on the server.
//
// Those files are written for Deno: they import `npm:<pkg>@<version>`, read `Deno.env.get(...)` and
// hand their handler to `Deno.serve(...)`. Here, a resolve hook maps `npm:<pkg>@<version>` to the
// package installed in node_modules, a small `Deno` global maps env reads to process.env and
// captures the handler instead of starting a server, and api-server.ts calls that handler with a
// standard Request. The same file keeps working as a Supabase function.
// ═══════════════════════════════════════════════════════════════════════════
import { registerHooks } from 'node:module';

type Handler = (req: Request) => Response | Promise<Response>;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('npm:')) {
      // npm:@supabase/supabase-js@2 → @supabase/supabase-js ; npm:pkg@1.2.3/sub → pkg/sub
      const bare = specifier.slice(4).replace(/^(@[^/@]+\/[^/@]+|[^/@]+)@[^/]+/, '$1');
      return nextResolve(bare, context);
    }
    return nextResolve(specifier, context);
  },
});

let captured: Handler | null = null;
(globalThis as any).Deno ??= {
  env: { get: (key: string) => process.env[key] },
  serve: (a: unknown, b?: unknown) => {
    captured = (typeof a === 'function' ? a : b) as Handler;
    return { finished: Promise.resolve(), shutdown: async () => {} };
  },
};

const hasGoogle = () => !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.VERTEX_API_KEY);

// The functions served here, each with the keys it can't work without. A function whose keys aren't
// set answers 501, so the site falls back to the Supabase function instead.
export const FUNCTIONS: Record<string, () => boolean> = {
  'transcript': () => !!process.env.SUPADATA_API_KEY,
  'match-style': () => hasGoogle() || !!process.env.OPENROUTER_API_KEY,
  // tagging + embedding: Google Cloud and/or OpenRouter, per the admin's text provider setting
  'index-style': () => hasGoogle() || !!process.env.OPENROUTER_API_KEY,
  'admin-styles': () => hasGoogle() || !!process.env.OPENROUTER_API_KEY,
  // payments (Dodo) and thumbnail deletes — user-decided: these run here too, not as Supabase functions
  'create-checkout': () => !!process.env.DODO_PAYMENTS_API_KEY,
  'dodo-webhook': () => !!process.env.DODO_WEBHOOK_SECRET,
  'delete-generation': () => true,
};

const handlers = new Map<string, Promise<Handler>>();
let queue: Promise<unknown> = Promise.resolve();

export const loadFunction = (name: string): Promise<Handler> => {
  let h = handlers.get(name);
  if (!h) {
    // one import at a time (each only on its function's first request), so the handler captured is
    // always the one that import registered
    h = queue.then(async () => {
      captured = null;
      await import(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url).href);
      const handler = captured as Handler | null;
      if (!handler) throw new Error(`${name} did not register a handler`);
      return handler;
    });
    queue = h.catch(() => {});
    handlers.set(name, h);
    h.catch(() => handlers.delete(name));
  }
  return h;
};
