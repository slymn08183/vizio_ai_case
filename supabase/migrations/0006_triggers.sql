-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0006 — Triggers: is_public denormalization sync + user provisioning       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Owner: 01-data-model.md §6 (is_public sync) + 03-auth-and-session.md §4
-- (handle_new_user). All SECURITY DEFINER + SET search_path = ''.

-- ── posts.is_public set on INSERT (BEFORE INSERT on posts) ───────────────────
-- Fills posts.is_public from the owning team so application code never sets the
-- flag. A DEFAULT cannot reference another table, and trusting every Server
-- Action to set it correctly is exactly the drift-prone duplication to avoid:
-- one trigger makes the flag impossible to set wrong (even from psql).
create or replace function public.posts_set_is_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select t.is_public
    into new.is_public
    from public.teams t
   where t.id = new.team_id;

  if new.is_public is null then
    raise exception 'posts_set_is_public: team % not found', new.team_id;
  end if;

  return new;
end;
$$;

create trigger posts_set_is_public_before_insert
  before insert on public.posts
  for each row
  execute function public.posts_set_is_public();

-- ── posts.is_public kept in sync on team toggle (AFTER UPDATE on teams) ──────
-- Privacy toggles are rare, so the bulk UPDATE is an acceptable infrequent cost —
-- far cheaper than joining teams on every feed read. The when() clause + inner
-- "is distinct from" make renames a no-op (they don't rewrite every post).
create or replace function public.teams_sync_posts_is_public()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_public is distinct from old.is_public then
    update public.posts
       set is_public = new.is_public
     where team_id = new.id
       and is_public is distinct from new.is_public;
  end if;
  return new;
end;
$$;

create trigger teams_sync_posts_is_public_after_update
  after update of is_public on public.teams
  for each row
  when (old.is_public is distinct from new.is_public)
  execute function public.teams_sync_posts_is_public();

-- ── handle_new_user — provisioning (AFTER INSERT on auth.users) ──────────────
-- Runs SYNCHRONOUSLY inside the signup transaction so team + profile exist before
-- any token is minted. Creates team + profile ONLY; it NEVER writes
-- raw_app_meta_data — claim injection is the Auth Hook's job (0007). Writing
-- metadata here races the token mint (the original "claims missing on first
-- token" bug). New team defaults PRIVATE + un-onboarded until /onboarding.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
begin
  insert into public.teams (name, is_public, onboarded)
  values (
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'team_name'), ''), 'My Team'),
    false,
    false
  )
  returning id into v_team_id;

  insert into public.profiles (id, team_id, email)
  values (new.id, v_team_id, new.email);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
