-- pgTAP: follow approval scoping + column lockdown (requirement #4, regression
-- guard for the prior plan's "follows UPDATE not column-restricted" bug).

begin;
select plan(3);

insert into public.teams (id, name, is_public, onboarded) values
  ('aaaa1111-0000-0000-0000-000000000000', 'Team A', true,  true),
  ('bbbb2222-0000-0000-0000-000000000000', 'Team B', false, true),
  ('cccc3333-0000-0000-0000-000000000000', 'Team C', true,  true);

-- A → B pending (A asks to follow private B). C → A pending (so A is a followee).
insert into public.follows (follower_team_id, following_team_id, status) values
  ('aaaa1111-0000-0000-0000-000000000000', 'bbbb2222-0000-0000-0000-000000000000', 'pending'),
  ('cccc3333-0000-0000-0000-000000000000', 'aaaa1111-0000-0000-0000-000000000000', 'pending');

-- Act as a member of Team A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"team_id":"aaaa1111-0000-0000-0000-000000000000"}}';

-- (1) The FOLLOWER cannot self-approve its own outgoing request to B.
update public.follows set status = 'approved'
  where follower_team_id = 'aaaa1111-0000-0000-0000-000000000000'
    and following_team_id = 'bbbb2222-0000-0000-0000-000000000000';
reset role;
select is(
  (select status::text from public.follows
     where follower_team_id = 'aaaa1111-0000-0000-0000-000000000000'
       and following_team_id = 'bbbb2222-0000-0000-0000-000000000000'),
  'pending',
  'a follower cannot approve its own outgoing request (RLS UPDATE blocked → 0 rows)'
);

-- (2) Positive control: the FOLLOWEE (A) CAN approve the incoming C → A request.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"team_id":"aaaa1111-0000-0000-0000-000000000000"}}';
update public.follows set status = 'approved'
  where follower_team_id = 'cccc3333-0000-0000-0000-000000000000'
    and following_team_id = 'aaaa1111-0000-0000-0000-000000000000';
reset role;
select is(
  (select status::text from public.follows
     where follower_team_id = 'cccc3333-0000-0000-0000-000000000000'
       and following_team_id = 'aaaa1111-0000-0000-0000-000000000000'),
  'approved',
  'the followee CAN approve an incoming request'
);

-- (3) Even as the legitimate followee, A cannot rewrite the FK columns — the
--     column-level GRANT exposes only `status`, so this is rejected at the
--     privilege layer (42501) regardless of RLS.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","app_metadata":{"team_id":"aaaa1111-0000-0000-0000-000000000000"}}';
select throws_ok(
  $$ update public.follows set follower_team_id = 'bbbb2222-0000-0000-0000-000000000000'
       where following_team_id = 'aaaa1111-0000-0000-0000-000000000000' $$,
  '42501',
  null,
  'approver cannot rewrite follower/following columns (GRANT UPDATE(status) only)'
);
reset role;

select * from finish();
rollback;
