-- ═══════════════════════════════════════════════════════════════════════════
-- Rate limit for the FREE helper tools (Chapter Maker, YouTube-concept text,
-- transcript fetch). These are gated by login but not by credits, and had NO
-- cap at all — a signed-in user could hit "Generate" repeatedly and burn a
-- Supadata transcript fetch + a full LLM completion (up to a 24k-char
-- transcript prompt) on every single click, for free, indefinitely.
--
-- Service-role only (no RLS policies granted to anon/authenticated — same
-- pattern as spend_credit/refund_credit), so it's invisible to the client.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists public.tool_usage (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  tool       text not null,
  created_at timestamptz not null default now()
);
create index if not exists tool_usage_user_tool_idx on public.tool_usage(user_id, tool, created_at desc);

alter table public.tool_usage enable row level security;
-- Intentionally no policies: RLS with zero grants denies all client access;
-- only the service role (used by the Edge Functions) can read/write.
