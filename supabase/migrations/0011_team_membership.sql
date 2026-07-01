-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0011 — Team membership: invite codes, join-or-create, member mgmt         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Owner: plan "Team Membership (davet kodu)", sections D1/D2. Closes the one
-- material scope gap in the MVP: handle_new_user() (0006) always created a
-- BRAND NEW team on signup, so a second person could never join an existing
-- one — every team was effectively single-member even though profiles.team_id
-- was never declared UNIQUE (multi-member was always modeled, just
-- unreachable). This migration adds an invite-code join path plus member
-- management, with NO team_members join table (profiles IS the membership
-- table — team_id is not unique) and NO roles (every member has equal
-- privileges — both are locked product decisions, see CLAUDE.md).
--
-- Every SECURITY DEFINER function below follows 0004's envelope: SET
-- search_path = '' + schema-qualified names + an in-body caller guard (never
-- trust a passed-in id/code without re-deriving the truth from the verified
-- JWT or from the DB), then `revoke all from public; grant execute to <role>`.
--
-- Non-goals (unchanged from the plan, do not regress): no team_members table,
-- no roles/permissions, no per-post/per-message attribution beyond team
-- identity (email is exposed only via profiles_select_own_team, 0005,
-- unchanged). 0008/0009/0010 (get_inbox, get_teams_directory, read-state) are
-- untouched — they already operate at the team level, so multi-member teams
-- need no changes there.

-- ── gen_invite_code() — invite code generator (owner-only) ──────────────────
-- Two gen_random_uuid() halves, hex-only, concatenated for ~64 bits of
-- entropy — plenty for a human-shared code additionally backstopped by the
-- UNIQUE constraint on team_invites.code below. gen_random_uuid() is a
-- pg_catalog BUILT-IN as of Postgres 13 (no extension needed), and pg_catalog
-- is ALWAYS implicitly searched regardless of search_path — including
-- search_path = '' — so this resolves cleanly unqualified. Deliberately NOT
-- using extensions.gen_random_bytes(): pgcrypto lives in the `extensions`
-- schema on Supabase, which is schema-ambiguous under search_path = '' unless
-- explicitly qualified, for no upside here.
-- No grants below on purpose: this is an internal helper, only ever called
-- FROM another SECURITY DEFINER function running as the owner — ownership
-- always implies EXECUTE on your own objects, so nothing else needs access.
create or replace function public.gen_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select upper(
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
  );
$$;

revoke all on function public.gen_invite_code() from public;

-- ── team_invites — one active code per team (D1: table, NOT a teams column) ─
-- A separate table makes the secret STRUCTURALLY unreachable everywhere else:
-- `teams` is the most-read table in the app (public directory, feed joins,
-- anon reads) and putting the code there would mean every one of those read
-- paths has to remember to exclude one column, forever, on pain of a
-- permanent leak. A dedicated table + a single
-- `team_id = current_user_team_id()` policy is a default-deny that cannot
-- regress by omission.
create table public.team_invites (
  team_id    uuid        primary key references public.teams (id) on delete cascade,
  code       text        not null unique,
  created_at timestamptz not null default now()
);

alter table public.team_invites enable row level security;

-- Defense-in-depth: explicit revoke before the one narrow grant (matches
-- 0005's style for every other table — RLS already default-denies, but a
-- revoked GRANT rejects at layer 1 before RLS even runs).
revoke all on public.team_invites from anon, authenticated;
grant select on public.team_invites to authenticated;
-- No INSERT/UPDATE/DELETE policy for any client role — the only writers are
-- handle_new_user() and the SECURITY DEFINER RPCs below, all of which run as
-- the table owner and so bypass RLS the same way handle_new_user already does
-- today for `teams`/`profiles` (0006) with no client write policy either.

create policy "team_invites_select_own_team"
on public.team_invites for select to authenticated
using ( team_id = (select public.current_user_team_id()) );

-- ── Backfill — every existing team (including seed teams) gets a code ───────
-- Idempotent: only inserts for teams that don't already have a row, so this
-- statement is safe to re-run against a database that already has some
-- invites (e.g. local dev after a partial apply).
insert into public.team_invites (team_id, code)
select t.id, public.gen_invite_code()
from public.teams t
left join public.team_invites ti on ti.team_id = t.id
where ti.team_id is null;

-- ── invite_code_valid() — safe pre-validation, callable BEFORE signup ────────
-- Returns true/false ONLY — never the team id or name — so it is safe to
-- grant to `anon` for client-side pre-validation on the signup form, without
-- turning it into a way to enumerate teams or probe team_invites contents.
create or replace function public.invite_code_valid(_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_invites where code = upper(trim(_code))
  );
$$;

revoke all on function public.invite_code_valid(text) from public;
grant execute on function public.invite_code_valid(text) to anon, authenticated;

-- ── handle_new_user() — CREATE-or-JOIN (0006 rewritten; trigger untouched) ──
-- Still runs SYNCHRONOUSLY inside the signup transaction (AFTER INSERT on
-- auth.users, via the on_auth_user_created trigger created in 0006 — that
-- CREATE TRIGGER statement is untouched; only this function body changes) so
-- a team + profile exist before any token is minted. Still NEVER writes
-- raw_app_meta_data (claim injection stays the Auth Hook's job alone, 0007) —
-- writing metadata here would race the token mint, the original "claims
-- missing on first token" bug.
--
-- NEW: an optional invite_code in raw_user_meta_data now branches CREATE vs
-- JOIN. CRITICAL SAFETY RULE: an invalid/missing code must NEVER raise here.
-- GoTrue wraps ANY exception raised by this trigger into one opaque, generic
-- "Database error saving new user" and aborts the ENTIRE signup — there is no
-- way for the client to distinguish "bad code" from "the database is on
-- fire", and the user is simply locked out of signing up at all. So an
-- unresolvable code silently falls through to the exact same CREATE branch as
-- a signup with no code at all — this also closes the validate-then-signup
-- TOCTOU race (a code that was valid when the client pre-checked it via
-- invite_code_valid() but got regenerated a second later degrades to
-- "create your own team" instead of a hard failure).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code    text := nullif(trim(new.raw_user_meta_data ->> 'invite_code'), '');
  v_team_id uuid;
begin
  if v_code is not null then
    select ti.team_id into v_team_id
      from public.team_invites ti
     where ti.code = upper(v_code);
  end if;

  -- v_team_id is still null here for BOTH "no code was supplied" and "the
  -- code didn't match anything" — the CREATE branch below handles both
  -- identically, on purpose (see safety note above).
  if v_team_id is null then
    insert into public.teams (name, is_public, onboarded)
    values (
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'team_name'), ''), 'My Team'),
      false,
      false
    )
    returning id into v_team_id;

    insert into public.team_invites (team_id, code)
    values (v_team_id, public.gen_invite_code());
  end if;

  insert into public.profiles (id, team_id, email)
  values (new.id, v_team_id, new.email);

  return new;
end;
$$;

-- ── regenerate_invite_code() — rotate MY team's code (old one dies instantly) ─
-- No parameters: the ONLY team this can ever touch is current_user_team_id(),
-- resolved server-side from the verified JWT — there is no team-id argument
-- for a caller to substitute, structurally ruling out "regenerate someone
-- else's code". Upsert (not a bare UPDATE) so a team that somehow has no row
-- yet (pre-backfill edge case, belt-and-suspenders) gets one instead of
-- silently no-op'ing.
create or replace function public.regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _me   uuid := public.current_user_team_id();
  _code text;
begin
  if _me is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  _code := public.gen_invite_code();

  insert into public.team_invites (team_id, code, created_at)
  values (_me, _code, now())
  on conflict (team_id) do update
    set code       = excluded.code,
        created_at = excluded.created_at;

  return _code;
end;
$$;

revoke all on function public.regenerate_invite_code() from public;
grant execute on function public.regenerate_invite_code() to authenticated;

-- ── remove_team_member() — kick a TEAMMATE (never yourself) ─────────────────
-- The one function here that takes another user's id, so it gets the
-- sharpest guard: (1) caller must have a team; (2) caller cannot target their
-- own auth.uid() (use leave_team() to exit voluntarily — keeps "I removed
-- myself" and "I got kicked" as distinct, unambiguous code paths); (3) the
-- target's CURRENT team is read fresh from `profiles` (never trusted from the
-- argument) and compared to the caller's own verified team — a cross-team
-- target and a nonexistent target id raise the exact SAME 42501, so this can
-- never be used as an oracle to probe whether some arbitrary uuid belongs to
-- some other team. Because the caller can never target themselves, the
-- caller's own row always survives this call — a team can never be emptied
-- via remove_team_member.
create or replace function public.remove_team_member(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _me             uuid := public.current_user_team_id();
  _target_team_id uuid;
begin
  if _me is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if _user_id = auth.uid() then
    raise exception 'cannot remove yourself — use leave_team() instead' using errcode = '42501';
  end if;

  select p.team_id into _target_team_id
    from public.profiles p
   where p.id = _user_id;

  if _target_team_id is null or _target_team_id <> _me then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.profiles where id = _user_id;
end;
$$;

revoke all on function public.remove_team_member(uuid) from public;
grant execute on function public.remove_team_member(uuid) to authenticated;

-- ── create_solo_team() — teamless recovery: spin up a fresh team for ME ─────
-- Used by /no-team (a member who was just removed) and internally by
-- leave_team() below. Zero parameters name a person or a team — the only
-- identity involved is auth.uid(), read server-side from the verified JWT, so
-- this can only ever create a team FOR the caller and can only ever write the
-- CALLER's own `profiles` row (`on conflict (id)` keys off auth.uid(), never
-- an argument — no other user's row is reachable). Upsert (not a bare INSERT)
-- so it is safe to call whether the caller currently has zero profiles rows
-- (kicked) or already has one (defensive — a normal member calling this
-- directly just self-service-relocates to a brand-new team, which is no more
-- powerful than leave_team() and touches only their own row either way).
create or replace function public.create_solo_team(_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _me          uuid := auth.uid();
  _email       text;
  _new_team_id uuid;
begin
  if _me is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select email into _email from auth.users where id = _me;

  insert into public.teams (name, is_public, onboarded)
  values (
    coalesce(nullif(trim(_name), ''), 'My Team'),
    false,
    false
  )
  returning id into _new_team_id;

  insert into public.team_invites (team_id, code) values (_new_team_id, public.gen_invite_code());

  insert into public.profiles (id, team_id, email)
  values (_me, _new_team_id, _email)
  on conflict (id) do update
    set team_id = excluded.team_id;

  return _new_team_id;
end;
$$;

revoke all on function public.create_solo_team(text) from public;
grant execute on function public.create_solo_team(text) to authenticated;

-- ── leave_team() — voluntary exit: re-provision + move MY OWN row ───────────
-- Thin guard in front of create_solo_team(): a leaver must currently,
-- VERIFIABLY (checked against profiles, not just trusted from the JWT claim)
-- belong to the team their token claims — this closes a stale-token edge case
-- (e.g. someone else's remove_team_member call already fired earlier in the
-- same, not-yet-refreshed session) that would otherwise mint an orphan team
-- while the profile UPDATE silently touches 0 rows. Past the guard, all the
-- actual team-creation + profile-move logic lives in exactly ONE place
-- (create_solo_team) instead of being duplicated. The old team is left
-- exactly as-is — an empty team is harmless (no cleanup, no cascade) —
-- matching remove_team_member's "never touch anything but the caller's own
-- membership" posture.
create or replace function public.leave_team(_new_team_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _old_team_id uuid := public.current_user_team_id();
begin
  if auth.uid() is null or _old_team_id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and team_id = _old_team_id
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return public.create_solo_team(_new_team_name);
end;
$$;

revoke all on function public.leave_team(text) from public;
grant execute on function public.leave_team(text) to authenticated;

-- ── join_team_by_code() — teamless recovery / explicit join by code ─────────
-- Mirror of create_solo_team() for the JOIN case: the only argument is a
-- CODE, never a team id, so the caller can only land on a team whose secret
-- they actually possess — knowledge-of-the-secret IS the authorization here,
-- by design (the whole point of the feature). Same upsert-my-own-row shape as
-- create_solo_team(): `on conflict (id)` keys off auth.uid(), so this can
-- never write anyone else's profile.
--
-- Unlike handle_new_user(), THIS may raise on an invalid code — it is a plain
-- RPC called from an already-authenticated session (the /no-team recovery
-- page), not a trigger inside GoTrue's signup transaction, so a raised
-- exception just surfaces as a normal Postgres error the Server Action can
-- catch and turn into an ActionState message. The GoTrue opaque-500 trap
-- documented on handle_new_user() only applies there, not here.
create or replace function public.join_team_by_code(_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _me      uuid := auth.uid();
  _email   text;
  _team_id uuid;
begin
  if _me is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select ti.team_id into _team_id
    from public.team_invites ti
   where ti.code = upper(trim(_code));

  if _team_id is null then
    raise exception 'invalid invite code' using errcode = 'P0001';
  end if;

  select email into _email from auth.users where id = _me;

  insert into public.profiles (id, team_id, email)
  values (_me, _team_id, _email)
  on conflict (id) do update
    set team_id = excluded.team_id;

  return _team_id;
end;
$$;

revoke all on function public.join_team_by_code(text) from public;
grant execute on function public.join_team_by_code(text) to authenticated;
