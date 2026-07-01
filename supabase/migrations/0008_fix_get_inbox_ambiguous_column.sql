-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 0008 — fix: get_inbox() ambiguous "conversation_id" column reference       ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
-- The function's OUT parameter conversation_id shadowed public.messages'
-- conversation_id column inside the lateral subquery (Postgres error 42702).
-- Fix: alias the table and qualify the column so PL/pgSQL can disambiguate.

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
    raise exception 'forbidden' using errcode = '42501';
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
