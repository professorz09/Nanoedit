-- Adds an "own styles only" mode to the YouTube auto-style match — a user
-- can now restrict the vector search to just their own uploaded custom
-- styles instead of the global pool + their own. New 4-arg overload rather
-- than changing the existing 3-arg one so match-style/index.ts can keep
-- calling the plain (query_embedding, match_count, p_user_id) form when the
-- toggle is off, with no behavior change for existing callers.
create or replace function public.match_styles(query_embedding vector, match_count integer, p_user_id uuid, p_own_only boolean)
returns table(path text, name text, meta jsonb, similarity double precision)
language sql stable
set search_path = public
as $$
  select s.path, s.name, s.meta, 1 - (s.embedding <=> query_embedding) as similarity
  from public.style_images s
  where s.active = true
    and s.embedding is not null
    and (
      (p_own_only and s.user_id = p_user_id)
      or (not p_own_only and (s.user_id is null or s.user_id = p_user_id))
    )
  order by s.embedding <=> query_embedding
  limit match_count;
$$;

-- Same lockdown as migration 0014 — service_role only, never exposed to the
-- browser directly (the "match-style" Edge Function is the only caller).
revoke all on function public.match_styles(vector, integer, uuid, boolean) from public, anon, authenticated;
grant execute on function public.match_styles(vector, integer, uuid, boolean) to service_role;
