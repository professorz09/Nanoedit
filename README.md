<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# PodcastFlux (Nanoedit) — AI Thumbnail & Image Editor

A client-side AI thumbnail and image editor. Turn a prompt, a photo, or a
YouTube link into click-worthy 16:9 thumbnails (or edit any image with
natural language), backed by Supabase for auth/storage/credits and Dodo
Payments for billing.

## Key features

- Natural-language image editing (prompt + optional source image)
- YouTube mode: paste a video link, auto-fetch the transcript, and generate
  on-brand thumbnails/titles from it
- Style picker with AI style-matching (vector search over a curated style
  library) and reusable Personas
- Multiple resolutions (Flash for 1K, Pro model for 2K/4K)
- Image queue for batch generation, with per-item retry
- Sketch/brush marking, background removal, upscaling, and other quick presets
- Persistent local state (IndexedDB for images, LocalStorage for settings)
- Bulk export via ZIP
- Google sign-in, per-user credit balance, and Pro/Studio subscription plans

## Tech stack

- **Frontend**: React 19 + TypeScript, Vite 6, Tailwind CSS (via PostCSS, see
  `tailwind.config.js` / `postcss.config.js`)
- **Backend**: Supabase (Postgres, Auth, Storage, Edge Functions) — see
  `supabase/migrations` and `supabase/functions`
- **Billing**: Dodo Payments, via the `create-checkout` and `dodo-webhook`
  edge functions
- **AI**: Gemini/Vertex or OpenRouter for image + text generation (see
  `vite.config.ts`'s dev-server proxy and `services/geminiService.ts`)
- **Deployment**: Vercel (`vercel.json`)

## Run locally

**Prerequisites:** Node.js 24.x, [pnpm](https://pnpm.io) 10.x

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create `.env.local` in the project root with whichever of these you need:

   | Variable | Purpose |
   |---|---|
   | `GOOGLE_APPLICATION_CREDENTIALS` | Path to a Google service-account JSON, used for Vertex image generation |
   | `VERTEX_API_KEY` | Vertex Express key, alternative to a service account for text generation |
   | `OPENROUTER_API_KEY` | Fallback/alternate model provider for image + text generation |
   | `SUPADATA_API_KEY` | Powers YouTube transcript fetching |
   | `VITE_SUPABASE_URL` | Supabase project URL (client-side) |
   | `VITE_SUPABASE_ANON_KEY` | Supabase anon/publishable key (client-side) |

   Only the vars for the features you're testing are required — the app
   degrades gracefully (e.g. no Supabase env vars means auth/credits/payments
   are disabled but local editing still works).
3. Run the dev server:
   ```bash
   pnpm dev
   ```
4. Build for production:
   ```bash
   pnpm build
   ```

## Project structure

```
App.tsx                 Root component, top-level state/routing
components/              UI components (editor, studio, modals, pickers)
services/                Client-side services (Gemini, Supabase, styles, payments, ...)
contexts/AuthContext.tsx Supabase auth/session/credits context
hooks/                   Reusable hooks (image queue, zoom/pan, persistence, ...)
types.ts                 Shared TypeScript types
attached_assets/         Real showcase/template thumbnails auto-loaded into the UI
supabase/migrations/     Postgres schema (profiles, credits, style images, ...)
supabase/functions/      Edge functions (generate, text, transcript, checkout, webhook, ...)
scripts/                 One-off maintenance scripts (style seeding/tagging, asset conversion)
```

## Keyboard shortcuts (Mac)

| Shortcut | Action |
|---|---|
| Cmd + Enter | Generate image |
| Cmd + S | Save/download first image |
| Cmd + Shift + S | Download all as ZIP |
| Cmd + U | Upload image |
| Cmd + I | Toggle Image Input mode |
| Cmd + B | Remove background (white) |
| Cmd + K | Clear prompt |
| Cmd + D | Duplicate last generated to layers |
| Cmd + . | Toggle UI visibility |
| Escape | Close viewer / clear images |

## Supabase backend

Schema and RLS policies live in `supabase/migrations/`, applied in order.
Server-only logic (crediting, plan expiry, style matching) lives in
`supabase/functions/` and is deployed as Edge Functions. Credits and plan
state are the source of truth in `public.profiles` / `public.credit_ledger`;
pricing/credit amounts are defined once in
`supabase/functions/_shared/pricing.ts` (mirrored for display only in
`services/plans.ts`).
