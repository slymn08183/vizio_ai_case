-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0002 — Table DDL (FK-dependency order)                                     ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Owner: 01-data-model.md §4. Created in dependency order:
-- teams → profiles → posts → follows → conversations → messages.

-- ── teams ────────────────────────────────────────────────────────────────────
-- is_public DEFAULT false: a team is PRIVATE until the user opts into Public in
-- onboarding (matches handle_new_user). Private-until-onboarding is the secure
-- default. onboarded DEFAULT false: seeded by the signup trigger, flipped true
-- when the user names the team. name CHECK: cheap server-side guard so a blank
-- or absurd name can never reach the DB even if a Zod check is bypassed.
create table public.teams (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null check (char_length(trim(name)) between 1 and 60),
  is_public  boolean     not null default false,
  onboarded  boolean     not null default false,
  created_at timestamptz not null default now()
);

-- ── profiles ─────────────────────────────────────────────────────────────────
-- id is simultaneously PK and FK to auth.users → physically enforces
-- "one user → one profile → one team". on delete cascade: auth user gone ⇒
-- profile gone. team_id on delete restrict: a team with members must not be
-- deletable out from under a live session's JWT claim.
create table public.profiles (
  id         uuid        primary key references auth.users (id) on delete cascade,
  team_id    uuid        not null references public.teams (id) on delete restrict,
  email      text        not null,
  created_at timestamptz not null default now()
);

create index profiles_team_id_idx on public.profiles (team_id);

-- ── posts ──────────────────────────────────────────────────────────────────
-- team_id DEFAULT current_user_team_id(): the single source for the owning team.
-- The client never sends team_id, so insert({ content }) is valid and the value
-- is resolved server-side from the verified JWT. The WITH CHECK policy (0005)
-- re-validates it, so the client can never spoof another team.
-- is_public has NO default on purpose — the BEFORE INSERT trigger (0006) fills it
-- from the owning team, so application code never sets it directly.
create table public.posts (
  id         uuid        primary key default gen_random_uuid(),
  team_id    uuid        not null references public.teams (id) on delete cascade
                         default public.current_user_team_id(),
  content    text        not null check (char_length(content) between 1 and 2000),
  is_public  boolean     not null,   -- DENORMALIZED from teams.is_public (trigger-maintained)
  created_at timestamptz not null default now()
);

-- ── follows ──────────────────────────────────────────────────────────────────
-- Single table + status enum (NOT separate follows/follow_requests): one source
-- of truth, approve = a single UPDATE. Composite PK doubles as the UNIQUE pair
-- guarantee (re-follow hits ON CONFLICT, not a duplicate). No sorting invariant —
-- follows are DIRECTIONAL (A→B ≠ B→A).
create table public.follows (
  follower_team_id  uuid                 not null references public.teams (id) on delete cascade,
  following_team_id uuid                 not null references public.teams (id) on delete cascade,
  status            public.follow_status not null default 'pending',
  created_at        timestamptz          not null default now(),

  primary key (follower_team_id, following_team_id),
  constraint follows_no_self_follow check (follower_team_id <> following_team_id)
);

-- ── conversations ────────────────────────────────────────────────────────────
-- Symmetric relationship: {X,Y} maps to exactly one row regardless of who starts.
-- team_a_id < team_b_id (CHECK) canonicalises the pair; UNIQUE(pair) dedupes it;
-- the strict < also forbids self-conversations (no separate CHECK needed).
create table public.conversations (
  id         uuid        primary key default gen_random_uuid(),
  team_a_id  uuid        not null references public.teams (id) on delete cascade,
  team_b_id  uuid        not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint conversations_canonical_order check (team_a_id < team_b_id),
  constraint conversations_unique_pair     unique (team_a_id, team_b_id)
);

-- ── messages ─────────────────────────────────────────────────────────────────
-- sender is a TEAM (messaging is team↔team; any member acts for their team).
-- RLS (0005) additionally enforces sender_team_id = current_user_team_id() AND
-- membership in the conversation.
create table public.messages (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null references public.conversations (id) on delete cascade,
  sender_team_id  uuid        not null references public.teams (id) on delete cascade,
  content         text        not null check (char_length(content) between 1 and 4000),
  created_at      timestamptz not null default now()
);
