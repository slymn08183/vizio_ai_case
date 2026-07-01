-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0010 — per-side read state on conversations + unread flag in get_inbox()   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- conversations had no write path (0005: "UPDATE/DELETE: no policy... denied").
-- Rather than open a client UPDATE policy (which needs per-column, per-side
-- WITH CHECK gymnastics to stop a team touching the OTHER side's read marker),
-- a narrow SECURITY DEFINER RPC does the one legal write: "set MY OWN side's
-- last_read_at to now()". The WHERE clause is the caller-guard — a team can
-- only ever touch the row it participates in, and only its own column.

alter table public.conversations
  add column if not exists team_a_last_read_at timestamptz,
  add column if not exists team_b_last_read_at timestamptz;

create or replace function public.mark_conversation_read(_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _me uuid := public.current_user_team_id();
begin
  if _me is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.conversations
  set team_a_last_read_at = case when team_a_id = _me then now() else team_a_last_read_at end,
      team_b_last_read_at = case when team_b_id = _me then now() else team_b_last_read_at end
  where id = _conversation_id
    and (team_a_id = _me or team_b_id = _me);
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant  execute on function public.mark_conversation_read(uuid) to authenticated;

-- ── get_inbox(): add `unread` — a message from the OTHER team, newer than my
-- own last_read_at (never read → treated as unread, i.e. coalesce to -infinity).
-- A `returns table(...)` signature is part of the function's row type, so
-- CREATE OR REPLACE can't add a column to it (Postgres 42P13) — drop first.
drop function if exists public.get_inbox(uuid);

create function public.get_inbox(_viewer_team_id uuid)
returns table (conversation_id uuid, other_team_id uuid, other_team_name text,
               last_message text, last_message_at timestamptz, unread boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if _viewer_team_id is null or _viewer_team_id <> public.current_user_team_id() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select c.id,
           case when c.team_a_id = _viewer_team_id then c.team_b_id else c.team_a_id end,
           t.name,
           m.content,
           m.created_at,
           exists (
             select 1 from public.messages msg
             where msg.conversation_id = c.id
               and msg.sender_team_id <> _viewer_team_id
               and msg.created_at > coalesce(
                 case when c.team_a_id = _viewer_team_id
                      then c.team_a_last_read_at
                      else c.team_b_last_read_at
                 end,
                 '-infinity'::timestamptz
               )
           )
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

-- DROP wipes the function's own grants — reinstate the same envelope as 0004.
revoke all on function public.get_inbox(uuid) from public;
grant  execute on function public.get_inbox(uuid) to authenticated;
