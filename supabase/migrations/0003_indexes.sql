-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0003 — Indexes (sole authoritative index set)                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Owner: 01-data-model.md §5. Every index is justified by a concrete query in
-- another plan file. FK columns do NOT auto-index in Postgres; these cover every
-- FK that participates in a JOIN or cascade-heavy delete.

-- ── posts ────────────────────────────────────────────────────────────────────
-- Mutation scoping & "my team's posts" lookups (RLS predicate team_id = me).
create index posts_team_id_idx     on public.posts (team_id);

-- Global newest-first ordering for the feed merge/sort and keyset pagination.
create index posts_created_at_idx  on public.posts (created_at desc);

-- Anonymous public-feed hot path: filter is_public = true, newest-first, WITHOUT
-- touching teams. Partial index stays tiny (public rows only); the id desc
-- tiebreaker matches the keyset ordering (07) so pagination never dupes/skips.
create index posts_public_feed_idx on public.posts (created_at desc, id desc)
  where is_public = true;

-- ── follows ──────────────────────────────────────────────────────────────────
-- "Who does my team follow (and is it approved)?" — drives the private-feed
-- subquery and check_team_follows(). follower-leading order matches the filter;
-- including status makes it covering for the approval check.
create index follows_follower_idx  on public.follows (follower_team_id, following_team_id, status);

-- Approved-only partial index for check_team_follows() — probed on every get_feed
-- call. Keeps the membership probe tiny and index-only.
create index follows_approved_idx  on public.follows (follower_team_id, following_team_id)
  where status = 'approved';

-- "Who is requesting to follow me?" — pending-requests inbox for a private team.
create index follows_following_idx on public.follows (following_team_id, status);

-- ── conversations ────────────────────────────────────────────────────────────
-- "List conversations my team is part of." team_a is covered by the UNIQUE
-- (team_a_id, team_b_id) index's leading column; add the team_b side.
create index conversations_team_b_idx on public.conversations (team_b_id);

-- ── messages ─────────────────────────────────────────────────────────────────
-- THE inbox-ordering index. Serves (a) loading a conversation's history
-- newest-first and (b) the LEFT JOIN LATERAL fetching each conversation's latest
-- message for inbox ordering (06) — both with no sort step.
create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
