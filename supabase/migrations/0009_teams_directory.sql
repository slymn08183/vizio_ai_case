-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0009 — teams directory: make private teams discoverable (name only)        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- teams_select_authenticated (0005) intentionally hides every private team but
-- your own — that's correct for CONTENT, but it also made private teams
-- impossible to find and follow at all (no name/id ever reaches the client).
-- This SECURITY DEFINER RPC exposes id/name/is_public for every onboarded team
-- so the Teams page can list private teams for follow-requesting, same as any
-- "private account, discoverable by name" model. It leaks NOTHING beyond
-- name + visibility flag — no posts, no members, no follow graph.

create or replace function public.get_teams_directory()
returns table (id uuid, name text, is_public boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select id, name, is_public
  from public.teams
  where onboarded = true
  order by name asc;
$$;

revoke all on function public.get_teams_directory() from public;
grant  execute on function public.get_teams_directory() to authenticated;
