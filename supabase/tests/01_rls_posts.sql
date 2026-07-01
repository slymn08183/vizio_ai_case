-- pgTAP: feed visibility — the public/private RLS split (requirement #6/#7).
-- Run with: supabase db test  (pgTAP must be available in the test database).
--
-- We simulate roles directly: `set local role anon|authenticated` selects the DB
-- role, and `request.jwt.claims` carries the app_metadata.team_id claim the Auth
-- Hook would inject in production (so current_user_team_id() resolves in tests).
-- is_public is omitted on inserts on purpose — the BEFORE INSERT trigger fills it
-- from the owning team.

begin;
select plan(3);

-- Seed as the table owner (RLS bypassed): one private team + one public team.
insert into public.teams (id, name, is_public, onboarded) values
  ('11111111-1111-1111-1111-111111111111', 'Private Co', false, true),
  ('22222222-2222-2222-2222-222222222222', 'Public Co',  true,  true);

insert into public.posts (id, team_id, content) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111', 'secret'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   '22222222-2222-2222-2222-222222222222', 'hello world');

-- The denormalization trigger must have copied the owning team's privacy.
select is(
  (select is_public from public.posts
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  false,
  'is_public is denormalized from the owning team on insert'
);

-- Act as a logged-out visitor.
set local role anon;

-- anon must NOT see the private team's post …
select is(
  (select count(*) from public.posts
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')::int,
  0,
  'anon cannot read a private team post'
);

-- … but MUST see the public team's post.
select is(
  (select count(*) from public.posts
     where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')::int,
  1,
  'anon CAN read a public team post'
);

reset role;
select * from finish();
rollback;
