-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ seed.sql — optional demo data (the plan's "0008")                         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Run automatically by `supabase db reset` (config.toml [db.seed]).
--
-- DESIGN: seeds only entities that do NOT depend on auth.users — demo teams,
-- posts, follows, a conversation and messages. This keeps the seed robust across
-- GoTrue versions (inserting auth.users with a valid bcrypt hash is
-- environment-sensitive and would risk breaking `db reset`). Demo USERS are
-- created via the signup UI; a fresh account then sees the public seed content
-- (and, per RLS, NOT the private seed content — which is itself a demonstration).
--
-- is_public on posts is intentionally omitted: the BEFORE INSERT trigger
-- (0006) fills it from the owning team. All inserts are idempotent.

-- ── Demo teams ───────────────────────────────────────────────────────────────
insert into public.teams (id, name, is_public, onboarded) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Team Aurora',   true,  true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Team Borealis', true,  true),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Team Cobalt',   false, true)
on conflict (id) do nothing;

-- ── Demo posts (is_public derived from the owning team by trigger) ───────────
insert into public.posts (id, team_id, content) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Aurora here 👋 — shipping our first public update. Welcome!'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'Public post #2 from Aurora: anyone, logged in or not, can read this.'),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'Borealis says hi. Follow us for more.'),
  ('44444444-4444-4444-4444-444444444444', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'Cobalt internal note — PRIVATE. Only Cobalt members and approved followers see this.')
on conflict (id) do nothing;

-- ── Demo follows ─────────────────────────────────────────────────────────────
-- Aurora follows Borealis (approved — both public). Borealis has requested to
-- follow private Cobalt (pending — shows up in Cobalt's request inbox).
insert into public.follows (follower_team_id, following_team_id, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'approved'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'pending')
on conflict (follower_team_id, following_team_id) do nothing;

-- ── Demo conversation + messages (Aurora ↔ Borealis) ─────────────────────────
-- team_a_id < team_b_id enforced via least()/greatest().
insert into public.conversations (id, team_a_id, team_b_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   least ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),
   greatest('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid))
on conflict (team_a_id, team_b_id) do nothing;

insert into public.messages (id, conversation_id, sender_team_id, content, created_at) values
  ('e1111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Hey Borealis — loved your latest post!', now() - interval '2 min'),
  ('e2222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Thanks Aurora! Want to collaborate?', now() - interval '1 min')
on conflict (id) do nothing;
