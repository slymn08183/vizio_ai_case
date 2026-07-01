-- pgTAP: conversation isolation (requirements #5/#7) — an unrelated team cannot
-- read another conversation's messages (this SELECT policy also gates Realtime).

begin;
select plan(2);

insert into public.teams (id, name, is_public, onboarded) values
  ('a0000000-0000-0000-0000-000000000000', 'A', true, true),
  ('b0000000-0000-0000-0000-000000000000', 'B', true, true),
  ('c0000000-0000-0000-0000-000000000000', 'C', true, true);

-- Canonical conversation A<B with one message.
insert into public.conversations (id, team_a_id, team_b_id)
values ('c0c0c0c0-0000-0000-0000-000000000000',
        'a0000000-0000-0000-0000-000000000000',
        'b0000000-0000-0000-0000-000000000000');

insert into public.messages (conversation_id, sender_team_id, content)
values ('c0c0c0c0-0000-0000-0000-000000000000',
        'a0000000-0000-0000-0000-000000000000', 'private to A and B');

-- A participant (Team B) CAN read the message — positive control.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","app_metadata":{"team_id":"b0000000-0000-0000-0000-000000000000"}}';
select is(
  (select count(*) from public.messages
     where conversation_id = 'c0c0c0c0-0000-0000-0000-000000000000')::int,
  1,
  'a conversation participant CAN read its messages'
);
reset role;

-- The unrelated Team C must see ZERO of that conversation's messages.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated","app_metadata":{"team_id":"c0000000-0000-0000-0000-000000000000"}}';
select is(
  (select count(*) from public.messages
     where conversation_id = 'c0c0c0c0-0000-0000-0000-000000000000')::int,
  0,
  'an outside team cannot read another conversation''s messages'
);
reset role;

select * from finish();
rollback;
