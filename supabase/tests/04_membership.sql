-- pgTAP: team membership — invite-code join, shared-team posting/messaging,
-- member removal, voluntary leave, and teamless recovery. Covers all 7 DB
-- verification points from the "Team Membership (davet kodu)" plan (D1/D2);
-- functions under test live in supabase/migrations/0011_team_membership.sql.
-- Run with: supabase db test.
--
-- auth.users rows ARE inserted directly here (unlike seed.sql, which avoids
-- this on purpose for GoTrue bcrypt-hash environment-sensitivity reasons) —
-- safe in this file because everything runs inside one ROLLBACKed
-- transaction and never goes through a real GoTrue login; only the FK from
-- profiles.id is exercised. Each insert fires the REAL on_auth_user_created
-- trigger (handle_new_user, 0011) exactly like a real signup with no invite
-- code — its own auto-created solo team is then left as harmless, unreferenced
-- noise while the profile is re-pointed at the fixed fixture team below. This
-- deliberately avoids assuming the test runner can ALTER TABLE auth.users
-- (disable/enable trigger) — only plain INSERT/UPDATE/DELETE privilege on the
-- ordinary tables is required.

begin;
select plan(25);

-- ── Fixtures: two teams + their invite codes + a conversation between them ──
insert into public.teams (id, name, is_public, onboarded) values
  ('a1111111-1111-1111-1111-111111111111', 'Shared Team T',           false, true),
  ('b2222222-2222-2222-2222-222222222222', 'Unrelated Public Team P', true,  true);

insert into public.team_invites (team_id, code) values
  ('a1111111-1111-1111-1111-111111111111', 'TEAMTCODE0000001'),
  ('b2222222-2222-2222-2222-222222222222', 'TEAMPCODE0000002');

insert into public.conversations (id, team_a_id, team_b_id) values
  ('c0000000-0000-0000-0000-000000000001',
   'a1111111-1111-1111-1111-111111111111',
   'b2222222-2222-2222-2222-222222222222');

-- ── Fixtures: A + B share T, C is on the unrelated P, D stays teamless ───────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'c@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'd@example.com');

-- Re-point each auto-provisioned profile at the fixed fixture team it needs
-- for this test (their own trigger-created solo teams are simply abandoned).
update public.profiles set team_id = 'a1111111-1111-1111-1111-111111111111'
  where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set team_id = 'a1111111-1111-1111-1111-111111111111'
  where id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set team_id = 'b2222222-2222-2222-2222-222222222222'
  where id = '00000000-0000-0000-0000-00000000000c';
-- D simulates a teamless caller (e.g. just removed, or a recovery scenario)
-- for requirement #7 — no profiles row at all.
delete from public.profiles where id = '00000000-0000-0000-0000-00000000000d';

-- ╔══ (1) T'yi paylaşan iki profil de T adına post atar + mesaj yazar ══════╗
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"team_id":"a1111111-1111-1111-1111-111111111111"}}';
insert into public.posts (id, content) values
  ('90000000-0000-0000-0000-000000000001', 'post from A, on behalf of T');
reset role;
select is(
  (select team_id from public.posts where id = '90000000-0000-0000-0000-000000000001'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'member A can post as shared team T'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","app_metadata":{"team_id":"a1111111-1111-1111-1111-111111111111"}}';
insert into public.posts (id, content) values
  ('90000000-0000-0000-0000-000000000002', 'post from B, on behalf of T');
reset role;
select is(
  (select team_id from public.posts where id = '90000000-0000-0000-0000-000000000002'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'joiner B (a DIFFERENT auth identity) can ALSO post as the same shared team T'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","app_metadata":{"team_id":"a1111111-1111-1111-1111-111111111111"}}';
insert into public.messages (conversation_id, sender_team_id, content) values
  ('c0000000-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111',
   'hello from B, on behalf of T');
reset role;
select is(
  (select count(*) from public.messages
     where conversation_id = 'c0000000-0000-0000-0000-000000000001'
       and sender_team_id  = 'a1111111-1111-1111-1111-111111111111')::int,
  1,
  'joiner B can ALSO send a message as the shared team T'
);

-- ╔══ (2) joiner B sees T's private feed via get_feed(T) ═══════════════════╗
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","app_metadata":{"team_id":"a1111111-1111-1111-1111-111111111111"}}';
select is(
  (select count(*)::int from public.get_feed('a1111111-1111-1111-1111-111111111111'::uuid)
     where id = '90000000-0000-0000-0000-000000000001'),
  1,
  'joiner B sees T''s (private) post via get_feed(T)'
);
reset role;

-- ╔══ (3) davet kodu sızmaz ═════════════════════════════════════════════════╗
set local role anon;
select is(
  (select count(*) from public.team_invites)::int,
  0,
  'anon cannot read ANY team_invites row'
);
reset role;

select is(
  public.invite_code_valid('TEAMTCODE0000001'),
  true,
  'invite_code_valid() confirms T''s real code without exposing team_id/name'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated","app_metadata":{"team_id":"b2222222-2222-2222-2222-222222222222"}}';
select is(
  (select count(*) from public.team_invites where team_id = 'a1111111-1111-1111-1111-111111111111')::int,
  0,
  'a member of a DIFFERENT (even public) team sees ZERO rows of T''s invite code'
);
select is(
  (select count(*) from public.team_invites)::int,
  1,
  'positive control: that same member DOES see their own team''s (P) invite row'
);
reset role;

-- ╔══ (4) regenerate: yeni≠eski, invite_code_valid(eski)=false ═════════════╗
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"team_id":"a1111111-1111-1111-1111-111111111111"}}';
select public.regenerate_invite_code();
reset role;

select isnt(
  (select code from public.team_invites where team_id = 'a1111111-1111-1111-1111-111111111111'),
  'TEAMTCODE0000001',
  'regenerate_invite_code() replaces T''s code with a new value'
);
select is(
  public.invite_code_valid('TEAMTCODE0000001'),
  false,
  'the OLD code is no longer valid after regenerate'
);

-- ╔══ (5) remove: guards + effects ══════════════════════════════════════════╗
-- (5a) A non-teammate (C, on the unrelated team P) cannot remove B (a member
-- of T) — and the failed attempt leaves B untouched.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated","app_metadata":{"team_id":"b2222222-2222-2222-2222-222222222222"}}';
select throws_ok(
  $$ select public.remove_team_member('00000000-0000-0000-0000-00000000000b'::uuid) $$,
  '42501',
  null,
  'a non-teammate cannot remove a member of a DIFFERENT team'
);
reset role;
select is(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000b')::int,
  1,
  'B is untouched after the non-teammate''s failed removal attempt'
);

-- (5b) A cannot "remove" itself (must use leave_team()).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"team_id":"a1111111-1111-1111-1111-111111111111"}}';
select throws_ok(
  $$ select public.remove_team_member('00000000-0000-0000-0000-00000000000a'::uuid) $$,
  '42501',
  null,
  'a caller cannot remove themselves via remove_team_member (use leave_team)'
);
reset role;

-- (5c) A (a genuine teammate) removes B — the legitimate path.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"team_id":"a1111111-1111-1111-1111-111111111111"}}';
select public.remove_team_member('00000000-0000-0000-0000-00000000000b'::uuid);
reset role;
select is(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000b')::int,
  0,
  'B''s profile is gone after a legitimate teammate removal'
);
select is(
  (select count(*) from public.teams where id = 'a1111111-1111-1111-1111-111111111111')::int,
  1,
  'no orphan FK / cascade damage: team T itself still exists after removing B'
);
select is(
  (select team_id from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'A (the remover) is still a member of T after removing B'
);

-- ╔══ (6) leave: A ayrılır → A yeni takımda (≠T), onboarded=false ══════════╗
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"team_id":"a1111111-1111-1111-1111-111111111111"}}';
select public.leave_team('A''s New Team');
reset role;

select isnt(
  (select team_id from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'after leave_team(), A''s profile points to a team DIFFERENT from T'
);
select is(
  (select t.onboarded
     from public.teams t
     join public.profiles p on p.team_id = t.id
    where p.id = '00000000-0000-0000-0000-00000000000a'),
  false,
  'A''s brand-new team (post-leave) starts un-onboarded'
);
select is(
  (select count(*) from public.teams where id = 'a1111111-1111-1111-1111-111111111111')::int,
  1,
  'the old team T still exists after everyone has left it (empty team is harmless)'
);

-- ╔══ (7) recovery: teamless caller reattaches via join_team_by_code ═══════╗
-- (7a) An invalid code is rejected (and D remains teamless) — join_team_by_code
-- is a plain RPC (not the signup trigger), so raising here is safe.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select throws_ok(
  $$ select public.join_team_by_code('NOT-A-REAL-CODE-AT-ALL') $$,
  'P0001',
  null,
  'join_team_by_code rejects an invalid code'
);
reset role;
select is(
  (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000d')::int,
  0,
  'D is still teamless after the failed join attempt'
);

-- (7b) The CURRENT valid code (read fresh — T's code was regenerated in (4))
-- reattaches D's profile to the correct team.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}';
select public.join_team_by_code(
  (select code from public.team_invites where team_id = 'a1111111-1111-1111-1111-111111111111')
);
reset role;
select is(
  (select team_id from public.profiles where id = '00000000-0000-0000-0000-00000000000d'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'teamless D reattaches to the correct team via join_team_by_code(valid code)'
);

-- ╔══ BONUS: handle_new_user() create-or-join via the REAL signup trigger ══╗
-- Targets the single riskiest line in 0011: an invalid invite_code at signup
-- must NOT raise (a raised exception here becomes GoTrue's opaque "Database
-- error saving new user" and blocks signup entirely — if this regresses, this
-- INSERT itself aborts the whole test transaction, which is an even louder
-- signal than a failed assertion).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000e', 'e@example.com',
   jsonb_build_object('invite_code', 'THIS-CODE-DOES-NOT-EXIST-AT-ALL'));

select isnt(
  (select team_id from public.profiles where id = '00000000-0000-0000-0000-00000000000e'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'signup with an INVALID invite code does not raise and does not join T (falls through to CREATE)'
);
select ok(
  (select team_id from public.profiles where id = '00000000-0000-0000-0000-00000000000e') is not null,
  'signup with an invalid invite code still provisions a brand-new team for the user'
);

-- A signup WITH the current valid code joins the EXISTING team T instead of
-- creating a new one.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000f', 'f@example.com',
   jsonb_build_object('invite_code',
     (select code from public.team_invites where team_id = 'a1111111-1111-1111-1111-111111111111')));

select is(
  (select team_id from public.profiles where id = '00000000-0000-0000-0000-00000000000f'),
  'a1111111-1111-1111-1111-111111111111'::uuid,
  'signup WITH a valid invite code joins the EXISTING team T instead of creating a new one'
);

select * from finish();
rollback;
