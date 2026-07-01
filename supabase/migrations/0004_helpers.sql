-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0004 — SECURITY DEFINER helpers & read RPCs                               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- Owner: 02-rls-and-security.md §3, §7 (security envelopes) + 05/06/07 (bodies),
-- reconciled by 00-overview.md §6.3/§6.4. current_user_team_id() lives in 0001
-- (needed by posts.team_id default). These helpers read tables, so they exist
-- here, after the tables (0002) and indexes (0003).
--
-- Every SECURITY DEFINER function uses SET search_path = '' + schema-qualified
-- names to block the object-shadowing attack DEFINER functions are exposed to.

-- ── check_team_follows() — the recursion breaker ─────────────────────────────
-- True iff _follower follows _following with status='approved'. SECURITY DEFINER
-- is non-negotiable: the posts SELECT policy must read follows from INSIDE a
-- policy; as invoker that would re-trigger follows' own RLS → infinite recursion.
-- Running as owner bypasses RLS, cutting the loop (and it is faster).
create or replace function public.check_team_follows(
  _follower_team_id  uuid,
  _following_team_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- CALLER GUARD (security): this DEFINER function bypasses `follows` RLS, so
  -- without a guard any caller could probe the private follow graph for ANY team
  -- pair via PostgREST and reconstruct who-follows-whom among private teams. The
  -- only legitimate callers (the posts SELECT policy and get_feed) always pass the
  -- caller's OWN team as _follower_team_id, so returning false for any other
  -- _follower closes the enumeration leak without affecting any real path.
  if _follower_team_id is distinct from public.current_user_team_id() then
    return false;
  end if;
  return exists (
    select 1
    from public.follows
    where follower_team_id  = _follower_team_id
      and following_team_id = _following_team_id
      and status = 'approved'
  );
end;
$$;

-- Defense-in-depth: remove the default PUBLIC execute grant so anon can't invoke
-- this DEFINER function at all. `authenticated` keeps it because the
-- posts_select_authenticated RLS policy evaluates it as the authenticated role;
-- the owner (and thus get_feed, which is DEFINER) always retains execute.
revoke all on function public.check_team_follows(uuid, uuid) from public;
grant  execute on function public.check_team_follows(uuid, uuid) to authenticated;

-- ── get_feed() — authenticated PRIVATE-slice feed (00 §6.3) ───────────────────
-- Returns the PRIVATE slice only (own-team private + approved-followed private),
-- each with its team_name. Public posts come from the cached public slice (07),
-- so the two slices are disjoint by is_public and merge with no de-dup.
-- The in-function ownership guard is the ONLY thing between a caller and arbitrary
-- data (DEFINER bypasses RLS): comparing _viewer_team_id to the verified
-- current_user_team_id() closes the escalation where any user could read another
-- team's private feed.
create or replace function public.get_feed(
  _viewer_team_id uuid,
  _cursor timestamptz default null,
  _limit  int default 20
)
returns table (id uuid, team_id uuid, team_name text, content text, is_public boolean, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if _viewer_team_id is null or _viewer_team_id <> public.current_user_team_id() then
    raise exception 'forbidden' using errcode = '42501';   -- privilege guard
  end if;
  return query
    select p.id, p.team_id, t.name, p.content, p.is_public, p.created_at
    from public.posts p
    join public.teams t on t.id = p.team_id
    where p.is_public = false
      and (p.team_id = _viewer_team_id
           or public.check_team_follows(_viewer_team_id, p.team_id))
      and (_cursor is null or p.created_at < _cursor)
    order by p.created_at desc, p.id desc
    limit least(_limit, 50);
end;
$$;

-- ── get_inbox() — conversations newest-first, with counterpart name ──────────
-- Surfaces a PRIVATE counterpart team's name that strict teams RLS would hide,
-- behind the same caller-ownership guard. Lateral join fetches each
-- conversation's latest message for ordering (zero write-amplification vs a
-- denormalized last_message_at; documented as the scale path).
create or replace function public.get_inbox(_viewer_team_id uuid)
returns table (conversation_id uuid, other_team_id uuid, other_team_name text,
               last_message text, last_message_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if _viewer_team_id is null or _viewer_team_id <> public.current_user_team_id() then
    raise exception 'forbidden' using errcode = '42501';   -- privilege guard
  end if;
  return query
    select c.id,
           case when c.team_a_id = _viewer_team_id then c.team_b_id else c.team_a_id end,
           t.name,
           m.content,
           m.created_at
    from public.conversations c
    join public.teams t
      on t.id = case when c.team_a_id = _viewer_team_id then c.team_b_id else c.team_a_id end
    left join lateral (
      select msg.content, msg.created_at from public.messages msg
      where msg.conversation_id = c.id
      order by msg.created_at desc limit 1
    ) m on true
    where c.team_a_id = _viewer_team_id or c.team_b_id = _viewer_team_id
    order by m.created_at desc nulls last;
end;
$$;

-- ── get_incoming_follow_requests() — pending requesters, with name ───────────
-- Same DEFINER envelope: reveals the requester team's name (even if private) for
-- the approve/reject inbox.
create or replace function public.get_incoming_follow_requests(_viewer_team_id uuid)
returns table (follower_team_id uuid, follower_team_name text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if _viewer_team_id is null or _viewer_team_id <> public.current_user_team_id() then
    raise exception 'forbidden' using errcode = '42501';   -- privilege guard
  end if;
  return query
    select f.follower_team_id, t.name, f.created_at
    from public.follows f
    join public.teams t on t.id = f.follower_team_id
    where f.following_team_id = _viewer_team_id
      and f.status = 'pending'
    order by f.created_at desc;
end;
$$;

-- ── Execute grants (read RPCs are authenticated-only; anon reads posts directly)
revoke all on function public.get_feed(uuid, timestamptz, int) from public;
grant  execute on function public.get_feed(uuid, timestamptz, int) to authenticated;

revoke all on function public.get_inbox(uuid) from public;
grant  execute on function public.get_inbox(uuid) to authenticated;

revoke all on function public.get_incoming_follow_requests(uuid) from public;
grant  execute on function public.get_incoming_follow_requests(uuid) to authenticated;
