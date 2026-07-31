-- ═══════════════════════════════════════════════════════════════════
-- AI topic-index for the style pool.
--
-- The YouTube flow now auto-picks a style based on the video's topic. To
-- match a transcript to a style we need to know what each style thumbnail
-- is ABOUT — its niche, emotion, colors, composition, etc. Rather than
-- hand-tag every image, scripts/tag-styles.mjs runs a vision model over
-- each style once and writes the result here.
--
-- `meta` is free-form so the tagging model can evolve without a migration.
-- Shape produced by tag-styles.mjs (all optional, all model-derived — no
-- hardcoded taxonomy):
--   {
--     "niche":        "gaming" | "finance" | "podcast" | ... (model's word),
--     "keywords":     ["...", "..."],   -- topic words a matcher can score
--     "emotion":      "shock" | "hype" | "calm" | ...,
--     "colors":       ["neon", "dark", ...],
--     "composition":  "short phrase describing layout/framing",
--     "has_face":     true | false,
--     "text_density": "none" | "low" | "high",
--     "summary":      "one line: what this thumbnail looks like / is about"
--   }
--
-- Read stays PUBLIC (the app matches client-side); writes stay
-- service-role only, same as the rest of style_images.
-- ═══════════════════════════════════════════════════════════════════

alter table public.style_images
  add column if not exists meta jsonb not null default '{}'::jsonb;

-- Marks when the row was last (re)tagged, so the script can skip already-tagged
-- rows and re-tag only new uploads.
alter table public.style_images
  add column if not exists tagged_at timestamptz;

-- ── Vector search ────────────────────────────────────────────────────
-- The YouTube flow embeds the video's topic and finds the closest styles by
-- cosine distance. Each style stores an embedding of its AI summary/keywords
-- (text-embedding-004 → 768 dims), produced by scripts/tag-styles.mjs.
create extension if not exists vector;

alter table public.style_images
  add column if not exists embedding vector(768);

-- Cosine-similarity search over the active, embedded styles. Callable by the
-- app (anon/authed) — it only reads active rows, same as the select policy.
create or replace function public.match_styles(query_embedding vector(768), match_count int default 8)
returns table (path text, name text, meta jsonb, similarity float)
language sql stable as $$
  select s.path, s.name, s.meta, 1 - (s.embedding <=> query_embedding) as similarity
  from public.style_images s
  where s.active = true and s.embedding is not null
  order by s.embedding <=> query_embedding
  limit match_count;
$$;
grant execute on function public.match_styles(vector, int) to anon, authenticated;
