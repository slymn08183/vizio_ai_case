-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0005 — Row-Level Security: enable + grants + policies                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Owner: 02-rls-and-security.md (whole). The DB — not the app — is the
-- authorization boundary. Two layers: (1) coarse table GRANT/REVOKE, then
-- (2) fine-grained RLS policies. A request must pass BOTH. Default-deny: once RLS
-- is enabled, a table with no permissive policy for a role denies all rows.
-- Helper calls are wrapped in (select …) for initPlan caching (once/statement).

-- ── (1) Enable RLS on EVERY table ────────────────────────────────────────────
-- Opt-in per table; one forgotten enable on a junction table is the classic
-- multi-tenant leak. Enable everywhere, then open additively.
alter table public.teams         enable row level security;
alter table public.profiles      enable row level security;
alter table public.posts         enable row level security;
alter table public.follows       enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

-- ── (2) Coarse table privileges ──────────────────────────────────────────────
grant usage on schema public to anon, authenticated;

-- anon: read-only on exactly the two tables the public feed needs.
grant select on public.posts to anon;
grant select on public.teams to anon;
-- Defense-in-depth: strip anon from everything sensitive (RLS already
-- default-denies, but a revoked GRANT rejects at layer 1 before RLS).
revoke all on public.profiles      from anon;
revoke all on public.follows       from anon;
revoke all on public.conversations from anon;
revoke all on public.messages      from anon;
revoke insert, update, delete on public.posts from anon;
revoke insert, update, delete on public.teams from anon;

-- authenticated: keep default CRUD (RLS scopes the rows). The ONE column-level
-- restriction is follows.status — approve/reject may touch ONLY status, never
-- follower/following (which would let a team forge an approved follow). RLS
-- WITH CHECK gates rows, not columns; a column GRANT enforces this at layer 1.
revoke update on public.follows from authenticated;
grant  update (status) on public.follows to authenticated;

-- ── supabase_auth_admin — Auth Hook read access UNDER RLS ────────────────────
-- The custom_access_token_hook (0007) runs as supabase_auth_admin, which is NOT
-- RLS-exempt. With RLS enabled, a plain GRANT is not enough — it also needs a
-- permissive SELECT policy on the two tables it reads, or token minting fails
-- closed and NOBODY can log in. These policies are scoped TO supabase_auth_admin
-- only, so they widen nothing for anon/authenticated.
grant usage on schema public to supabase_auth_admin;
grant select on public.profiles, public.teams to supabase_auth_admin;

create policy auth_admin_read_profiles on public.profiles
  for select to supabase_auth_admin using (true);
create policy auth_admin_read_teams on public.teams
  for select to supabase_auth_admin using (true);

-- ╔════════════════════════════════════════════════════════════════════════╗
-- ║ Per-table policies                                                       ║
-- ╚════════════════════════════════════════════════════════════════════════╝

-- ── teams ────────────────────────────────────────────────────────────────────
create policy "teams_select_anon"
on public.teams for select to anon
using ( is_public = true );

create policy "teams_select_authenticated"
on public.teams for select to authenticated
using (
  is_public = true
  or id = (select public.current_user_team_id())
);

-- A member may rename their team and toggle public/private. The is_public-sync
-- trigger (0006) propagates the toggle to posts.is_public.
create policy "teams_update_own"
on public.teams for update to authenticated
using      ( id = (select public.current_user_team_id()) )
with check ( id = (select public.current_user_team_id()) );
-- INSERT/DELETE: no client policy. Teams are created ONLY by handle_new_user()
-- (0006). Deletion is out of scope. Both denied for anon/authenticated.

-- ── profiles ─────────────────────────────────────────────────────────────────
-- A user may read the membership rows of their own team (list teammates). No
-- client write policy: the only writer is the provisioning trigger.
create policy "profiles_select_own_team"
on public.profiles for select to authenticated
using ( team_id = (select public.current_user_team_id()) );

-- ── posts ────────────────────────────────────────────────────────────────────
-- ANON: only public posts. No helper calls, no joins — the private predicate is
-- never even compiled into the anonymous query plan.
create policy "posts_select_anon"
on public.posts for select to anon
using ( is_public = true );

-- AUTHENTICATED: own team's posts + all public posts + posts of private teams I
-- follow (approved). This is the defense-in-depth backstop; the hot read path is
-- the get_feed RPC (0004).
create policy "posts_select_authenticated"
on public.posts for select to authenticated
using (
  team_id = (select public.current_user_team_id())
  or is_public = true
  or (select public.check_team_follows((select public.current_user_team_id()), team_id))
);

-- Any member may post AS their team. is_public is set by the trigger (0006).
create policy "posts_insert_own_team"
on public.posts for insert to authenticated
with check ( team_id = (select public.current_user_team_id()) );

create policy "posts_update_own_team"
on public.posts for update to authenticated
using      ( team_id = (select public.current_user_team_id()) )
with check ( team_id = (select public.current_user_team_id()) );

create policy "posts_delete_own_team"
on public.posts for delete to authenticated
using ( team_id = (select public.current_user_team_id()) );

-- ── follows ──────────────────────────────────────────────────────────────────
-- A team sees edges it is on either side of.
create policy "follows_select_participant"
on public.follows for select to authenticated
using (
  follower_team_id  = (select public.current_user_team_id())
  or following_team_id = (select public.current_user_team_id())
);

-- A team may create only follows where IT is the follower. The WITH CHECK is the
-- security backstop preventing a client from self-approving a follow to a PRIVATE
-- team: an approved edge to a private team may only be created when the target is
-- public. (05's BEFORE INSERT trigger forces the correct status; this is the hard
-- guarantee.)
create policy "follows_insert_as_follower"
on public.follows for insert to authenticated
with check (
  follower_team_id = (select public.current_user_team_id())
  and follower_team_id <> following_team_id
  and (
    status = 'pending'
    or (
      status = 'approved'
      and (select is_public from public.teams t where t.id = following_team_id) = true
    )
  )
);

-- Approve/reject: only the TARGET team (the followee) may act; the column GRANT
-- already restricts the write to the status column.
create policy "follows_update_status_as_followee"
on public.follows for update to authenticated
using      ( following_team_id = (select public.current_user_team_id()) )
with check ( following_team_id = (select public.current_user_team_id()) );

-- Unfollow / cancel-request: the follower removes its own edge. (A followee
-- "rejecting" sets status='rejected' via UPDATE, preserving an auditable state.)
create policy "follows_delete_as_follower"
on public.follows for delete to authenticated
using ( follower_team_id = (select public.current_user_team_id()) );

-- ── conversations ────────────────────────────────────────────────────────────
create policy "conversations_select_participant"
on public.conversations for select to authenticated
using (
  team_a_id = (select public.current_user_team_id())
  or team_b_id = (select public.current_user_team_id())
);

-- Open a conversation only if you are one of the two participants and not talking
-- to yourself. Creation uses upsert(onConflict, ignoreDuplicates) — see 06.
create policy "conversations_insert_participant"
on public.conversations for insert to authenticated
with check (
  team_a_id <> team_b_id
  and (
    team_a_id = (select public.current_user_team_id())
    or team_b_id = (select public.current_user_team_id())
  )
);
-- UPDATE/DELETE: no policy. Conversations are immutable headers; denied.

-- ── messages ─────────────────────────────────────────────────────────────────
-- Read messages only in conversations you participate in. This SELECT policy
-- ALSO gates Supabase Realtime (Postgres Changes) delivery — clients receive
-- INSERT events only for rows they may SELECT.
create policy "messages_select_participant"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (
        c.team_a_id = (select public.current_user_team_id())
        or c.team_b_id = (select public.current_user_team_id())
      )
  )
);

-- Send a message only AS your own team, and only into a conversation you are in.
create policy "messages_insert_as_sender_participant"
on public.messages for insert to authenticated
with check (
  sender_team_id = (select public.current_user_team_id())
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (
        c.team_a_id = (select public.current_user_team_id())
        or c.team_b_id = (select public.current_user_team_id())
      )
  )
);
-- UPDATE/DELETE: no policy. Messages are immutable in the MVP; denied.

-- ── Realtime delivery for messages ───────────────────────────────────────────
-- Add messages to the supabase_realtime publication so Postgres Changes streams
-- INSERTs to subscribers. Delivery is gated by messages_select_participant above
-- (a client receives only inserts it could SELECT) — zero extra realtime config.
-- Guarded so a bare Postgres without the publication doesn't fail the migration.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.messages;
  end if;
end$$;
