-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0001 — Extensions, enums, and the pure JWT tenant resolver                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Owner: 01-data-model.md §3 (extensions, enum), 02-rls-and-security.md §3.1
-- (current_user_team_id body).

-- pgcrypto provides gen_random_uuid(). Usually already present on Supabase, but
-- declaring it makes the migration self-contained and idempotent.
create extension if not exists "pgcrypto";

-- Follow lifecycle as a first-class, type-generator-visible domain.
-- (Compact 4-byte OID equality vs a scattered text + CHECK.)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'follow_status') then
    create type public.follow_status as enum ('pending', 'approved', 'rejected');
  end if;
end$$;

-- ── current_user_team_id() — the active-tenant resolver ──────────────────────
-- Reads ONLY the verified JWT claim populated by the Custom Access Token Auth
-- Hook (0007); touches no table, so SECURITY DEFINER is unnecessary.
--
-- DEPENDENCY-ORDERING NOTE: this function is defined here (not in 0004_helpers)
-- on purpose. posts.team_id (0002) has DEFAULT public.current_user_team_id(),
-- and Postgres must resolve that function at CREATE TABLE time — so it has to
-- exist BEFORE the tables. Because it has zero table dependencies, defining it
-- first is safe. (The remaining helpers, which read tables, stay in 0004.)
create or replace function public.current_user_team_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'team_id', '')::uuid
$$;

comment on function public.current_user_team_id() is
  'Active tenant (team_id) of the calling user, read from the verified JWT '
  'app_metadata claim injected by custom_access_token_hook. NULL when unauthenticated.';
