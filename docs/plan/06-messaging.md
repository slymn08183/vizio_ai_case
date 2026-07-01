# 06 — Team-to-Team Messaging

> **Scope of this file:** Direct (1:1) conversations between two **teams**. Any
> member of a team acts on behalf of that team's identity. Covers the
> `getOrCreateConversation` pattern, the `sendMessage` Server Action, the
> inbox/conversation list ordered by newest message, thread ordering, and live
> delivery via Supabase **Postgres Changes**.
>
> **Cross-references (not duplicated here):**
> - Table DDL for `conversations` / `messages`, the `team_a_id < team_b_id`
>   invariant, and indexes live in **`01-data-model.md`** (this file restates
>   only the messaging-relevant pieces and the lateral-join index it depends on).
> - RLS policies for `conversations` / `messages`, the `current_user_team_id()`
>   helper, and the `TO authenticated` membership predicates are owned by
>   **`02-rls-and-security.md`**. This file *assumes* those policies exist and
>   explains how the Realtime subscription inherits them.
> - JWT claim injection (`team_id` in `app_metadata` via the Custom Access Token
>   Auth Hook) and the awaited server client are owned by **`03-auth-and-session.md`**.
> - Server Action conventions (Zod validation, `{ success, message, errors? }`
>   return shape, `useActionState`) are owned by **`09-ai-blueprint-and-quality.md`**;
>   this file applies them.

---

## 1. Feature requirements recap

| Requirement | How it is satisfied |
|---|---|
| Messaging is **team ↔ team** | `conversations.team_a_id` / `team_b_id`; `messages.sender_team_id` |
| Any member acts **on behalf of their team** | `sender_team_id` is taken from the JWT claim, never from client input |
| A team **cannot message itself** | Sorted-id upsert + `CHECK (team_a_id < team_b_id)` + Server Action guard |
| **Start** a conversation | `getOrCreateConversation(targetTeamId)` (idempotent upsert) |
| **Send / receive** | `sendMessage` Server Action + Postgres Changes subscription |
| **History ordered newest-first** | Inbox list via `LEFT JOIN LATERAL max(created_at)`; thread renders `created_at ASC` and reverses for display, see §6 |
| **Persisted in DB** | All writes go through RLS-protected tables |

**Why team-scoped sender, not user-scoped:** the entire product model is
"tenant = team, no individual profiles." Storing `sender_team_id` (not a
`sender_user_id`) keeps the message identity consistent with posts and follows,
and means a teammate can continue a conversation another teammate started
without any ownership reassignment.

---

## 2. Data shapes this file depends on

Defined fully in `01-data-model.md`; reproduced here for context only.

```sql
-- conversations: exactly one row per unordered {team_a, team_b} pair
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  team_a_id   uuid not null references public.teams(id) on delete cascade,
  team_b_id   uuid not null references public.teams(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- INVARIANT: canonical ordering so an unordered pair maps to ONE row
  constraint conversations_canonical_order check (team_a_id < team_b_id),
  constraint conversations_unique_pair      unique (team_a_id, team_b_id)
);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_team_id  uuid not null references public.teams(id) on delete cascade,
  content         text not null check (char_length(content) between 1 and 4000),
  created_at      timestamptz not null default now()
);
```

### 2.1 Indexes this file requires

```sql
-- Hot path for the inbox lateral join AND for thread pagination.
-- One composite index serves both: "latest message in a conversation" and
-- "all messages in a conversation, newest first".
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

-- Inbox membership lookup: "all conversations where my team participates".
create index if not exists conversations_team_a_idx on public.conversations (team_a_id);
create index if not exists conversations_team_b_idx on public.conversations (team_b_id);
```

**Why `(conversation_id, created_at desc)`:** the lateral join in §5 reads
`max(created_at)` per conversation, and the thread view reads the newest *N*
rows of a single conversation. A single composite index with `created_at desc`
satisfies both as an index-only / index-range scan — no separate sort, no extra
index to maintain.

---

## 3. `getOrCreateConversation` — idempotent, race-free start

A conversation is an **unordered pair** of teams: `{A, B}` and `{B, A}` must
resolve to the *same* row. We enforce this by **sorting the two ids** before
writing, so the smaller uuid is always `team_a_id`. Combined with the
`UNIQUE (team_a_id, team_b_id)` constraint, two members on opposite teams
clicking "Message" at the same instant converge on one row.

```ts
// actions/messages.ts
'use server';

import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { getCurrentTeamId } from '@/lib/auth/claims'; // reads team_id from JWT, see 03

const StartSchema = z.object({
  targetTeamId: z.string().uuid(),
});

type ActionResult =
  | { success: true; conversationId: string }
  | { success: false; message: string; errors?: Record<string, string[]> };

export async function getOrCreateConversation(
  input: z.infer<typeof StartSchema>,
): Promise<ActionResult> {
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: 'Invalid request', errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();         // AWAITED — cookies() is async in Next 15
  const myTeamId = await getCurrentTeamId();       // from app_metadata.team_id claim

  const { targetTeamId } = parsed.data;

  // Guard: a team cannot message itself.
  if (targetTeamId === myTeamId) {
    return { success: false, message: 'A team cannot start a conversation with itself.' };
  }

  // Canonical ordering: smaller uuid -> team_a_id (satisfies the CHECK constraint).
  const [team_a_id, team_b_id] =
    myTeamId < targetTeamId ? [myTeamId, targetTeamId] : [targetTeamId, myTeamId];

  // Idempotent insert. onConflict matches the UNIQUE(team_a_id, team_b_id).
  // ignoreDuplicates:true => existing row is NOT updated and does NOT raise 23505;
  // we then re-select to get the id in both the "created" and "already existed" cases.
  const { error: upsertErr } = await supabase
    .from('conversations')
    .upsert({ team_a_id, team_b_id }, {
      onConflict: 'team_a_id,team_b_id',
      ignoreDuplicates: true,
    });

  if (upsertErr) {
    return { success: false, message: 'Could not open conversation.' };
  }

  // Re-select the canonical row (works whether it was just inserted or pre-existed).
  const { data: convo, error: selErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('team_a_id', team_a_id)
    .eq('team_b_id', team_b_id)
    .single();

  if (selErr || !convo) {
    return { success: false, message: 'Could not open conversation.' };
  }

  return { success: true, conversationId: convo.id };
}
```

**Why sorted ids + symmetric `CHECK (team_a_id < team_b_id)`:** without a
canonical order, `{A,B}` and `{B,A}` would be two distinct unique keys and
teams would end up with duplicate threads. Sorting collapses the unordered pair
into a single deterministic key; the `CHECK` makes the invariant a hard
database guarantee (a buggy client that forgets to sort gets rejected, not
silently duplicated). The strict `<` *also* makes self-messaging impossible at
the DB layer — `{A,A}` can never satisfy `A < A` — which is defense-in-depth
behind the Server Action's explicit self-check.

**Why `upsert({ onConflict, ignoreDuplicates:true })` instead of `.insert()`:**
a plain `.insert()` on a pre-existing pair throws Postgres error `23505`
(unique violation) that the action would have to catch and special-case.
`ignoreDuplicates:true` translates to `INSERT ... ON CONFLICT DO NOTHING`, which
is the idempotent, race-free primitive: concurrent first-time starts both
succeed, exactly one row exists, and neither caller has to interpret an error
code. We re-select afterward because `DO NOTHING` returns no row when the
conflict path is taken.

> **RLS note:** the `conversations` INSERT policy (owned by `02-rls-and-security.md`)
> requires `current_user_team_id()` to be one of `team_a_id` / `team_b_id`, so a
> team can only create conversations it is a participant in. The Server Action
> never trusts a client-supplied "my team id."

---

## 4. `sendMessage` Server Action

```ts
// actions/messages.ts
'use server';

import { z } from 'zod';
import { revalidateTag } from 'next/cache';
import { createClient } from '@/utils/supabase/server';
import { getCurrentTeamId } from '@/lib/auth/claims';
import { TAGS } from '@/lib/constants';   // single cache-tag registry (08 §3.6)

const SendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1, 'Message cannot be empty').max(4000),
});

type ActionResult =
  | { success: true }
  | { success: false; message: string; errors?: Record<string, string[]> };

export async function sendMessage(
  _prev: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = SendSchema.safeParse({
    conversationId: formData.get('conversationId'),
    content: formData.get('content'),
  });
  if (!parsed.success) {
    return { success: false, message: 'Invalid message', errors: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const myTeamId = await getCurrentTeamId();
  const { conversationId, content } = parsed.data;

  // Membership check: the sender's team MUST be a participant in this conversation.
  // Belt-and-suspenders — RLS also enforces this — but a clear early error beats a
  // silent 0-row RLS rejection, and it avoids leaking conversation existence.
  const { data: convo, error: convoErr } = await supabase
    .from('conversations')
    .select('team_a_id, team_b_id')
    .eq('id', conversationId)
    .single();

  if (convoErr || !convo) {
    return { success: false, message: 'Conversation not found.' };
  }
  if (convo.team_a_id !== myTeamId && convo.team_b_id !== myTeamId) {
    return { success: false, message: 'Your team is not part of this conversation.' };
  }

  // sender_team_id comes from the CLAIM, never from the client.
  const { error: insErr } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_team_id: myTeamId,
    content,
  });

  if (insErr) {
    return { success: false, message: 'Message failed to send.' };
  }

  // Realtime delivers the new row to the OTHER participant live (see §7).
  // We still revalidate the inbox so the conversation jumps to the top on
  // the sender's next navigation / refresh (server-rendered ordering).
  // Keyed per team so only this team's inbox cache entry is purged (00 §6.5).
  revalidateTag(TAGS.teamInbox(myTeamId));
  return { success: true };
}
```

**Why `sender_team_id` from the claim, not `formData`:** if the client supplied
the sender team, any member could spoof another team's identity. The JWT claim
is injected server-side by the Auth Hook and verified by `getUser()` in
middleware, so it is the only trustworthy source. RLS additionally rejects an
INSERT whose `sender_team_id <> current_user_team_id()`, so even a forged action
input cannot write under another team.

**Why an explicit membership check despite RLS:** RLS would reject a non-member
INSERT, but the failure surfaces as an opaque error. Reading the conversation
first lets us return a precise, user-facing message and confirms the
conversation exists for *this* team before we attempt the write. It is a
deliberate, cheap (indexed PK lookup) UX guard, not a replacement for RLS.

**Why `revalidateTag(TAGS.teamInbox(myTeamId))` and not `revalidatePath`:** only
the inbox ordering is affected by a new message; the **team-keyed** tag
(`inbox:${teamId}`, from the single registry in 08 §3.6) invalidates exactly
*this* team's inbox data cache entry (tag applied on the inbox fetch, §5) instead
of blowing away the whole route's cache or every team's inbox. The open thread
itself updates via Realtime, not via revalidation.

---

## 5. Inbox / conversation list — ordered by newest message

The inbox lists every conversation my team participates in, **most-recently-active
first**. We compute "most recent" with a `LEFT JOIN LATERAL` that pulls each
conversation's latest message timestamp at read time.

### 5.1 The query (exposed as an RPC for a clean single round-trip)

```sql
-- Signature declared in 01 §7; implemented here (06 owns the body). SECURITY DEFINER
-- so the join to public.teams can surface a PRIVATE counterpart team's name (00 §6.4),
-- which strict teams-SELECT RLS would otherwise hide.
create or replace function public.get_inbox(_viewer_team_id uuid)
returns table (
  conversation_id   uuid,
  other_team_id     uuid,
  other_team_name   text,
  last_message      text,
  last_message_at   timestamptz
)
language plpgsql
stable
security definer            -- controlled RLS bypass to read private counterpart team names
set search_path = ''
as $$
begin
  if _viewer_team_id is null or _viewer_team_id <> public.current_user_team_id() then
    raise exception 'forbidden' using errcode = '42501';   -- privilege guard (00 §6.4)
  end if;
  return query
    select
      c.id                                    as conversation_id,
      other.id                                as other_team_id,
      other.name                              as other_team_name,
      lm.content                              as last_message,
      lm.created_at                           as last_message_at
    from public.conversations c
    -- resolve "the other team" relative to the viewer
    join public.teams other
      on other.id = case
           when c.team_a_id = _viewer_team_id then c.team_b_id
           else c.team_a_id
         end
    -- LATERAL: for each conversation, fetch its single newest message
    left join lateral (
      select m.content, m.created_at
      from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc
      limit 1
    ) lm on true
    where c.team_a_id = _viewer_team_id
       or c.team_b_id = _viewer_team_id
    order by lm.created_at desc nulls last;   -- newest activity first; empty convos last
end;
$$;
grant execute on function public.get_inbox(uuid) to authenticated;   -- NOT anon
```

```ts
// usage in a Server Component
const supabase = await createClient();
const myTeamId = await getCurrentTeamId();
const { data: conversations } = await supabase
  .rpc('get_inbox', { _viewer_team_id: myTeamId })
  // tag so sendMessage's revalidateTag(TAGS.teamInbox(myTeamId)) can refresh
  // ordering (when fetched via the data cache; see note below).
  ;
```

> **Caching note:** because the inbox depends on `cookies()` (auth), the route
> renders dynamically. The `revalidateTag(TAGS.teamInbox(myTeamId))` call in
> `sendMessage` is meaningful only if the inbox read is wrapped in a tagged
> `unstable_cache` whose tag is the same keyed string `inbox:${myTeamId}`. For the MVP we keep the inbox
> read fully dynamic and rely on Realtime + `router.refresh()` for liveness;
> `revalidateTag` is the forward-compatible hook. See `07-home-feed.md` for the
> tag-keying-by-team_id rule we mirror here.

**Why `security definer` + the `_viewer_team_id = current_user_team_id()` guard
(00 §6.4):** the inbox must surface the **name of a private counterpart team** (a
team you message but don't follow), yet `teams` SELECT RLS deliberately hides
private teams' names. Running the function with *definer* rights lets the
`join public.teams` resolve those names in a controlled, audited way — exactly
like `get_feed` (00 §6.3). Because definer rights bypass RLS, the function
re-establishes the boundary itself: the guard rejects any `_viewer_team_id` that
is not the caller's own team (`raise 'forbidden'`), and the
`where c.team_a_id = _viewer_team_id or c.team_b_id = _viewer_team_id` predicate
restricts rows to the viewer's own conversations. `EXECUTE` is granted to
`authenticated` only. Pinning `search_path` to empty and fully schema-qualifying
every object prevents search-path hijacking.

**Why `LEFT JOIN LATERAL max(created_at)` over a denormalized `last_message_at`
column:** the lateral join computes recency *at read time* from the source of
truth (the `messages` table), so it is **always correct** and has **zero write
amplification** — sending a message is a single INSERT. A denormalized
`conversations.last_message_at` maintained by an `AFTER INSERT` trigger gives
marginally faster reads but updates the conversation row on *every* message,
producing write amplification and dead tuples (more vacuum churn) on the hottest
write path. With the `(conversation_id, created_at desc)` index, the lateral
`limit 1` is an index-range scan touching one row per conversation — fast enough
for an MVP-scale inbox. **Scale path (documented, not built):** add
`last_message_at` + an `AFTER INSERT` trigger once inbox read volume dominates
message write volume.

---

## 6. Thread (message history) ordering

The requirement says history is "ordered by newest message first." There are two
distinct orderings and we are deliberate about both:

- **Inbox list** → conversations sorted by their newest message, newest
  conversation first (§5, `order by lm.created_at desc`).
- **Thread view** → messages are *fetched* newest-first for cheap pagination,
  then *rendered* oldest-at-top / newest-at-bottom (standard chat UX). The
  newest message is the one visible at the bottom without scrolling.

```ts
// initial thread load (newest page first; keyset-paginate upward for older)
const { data: page } = await supabase
  .from('messages')
  .select('id, sender_team_id, content, created_at')
  .eq('conversation_id', conversationId)
  .order('created_at', { ascending: false })   // newest-first read (uses the desc index)
  .limit(30);

// render oldest→newest: reverse the page client-side
const ordered = (page ?? []).slice().reverse();
```

**Why fetch DESC but render ASC:** `order by created_at desc limit 30` uses the
`(conversation_id, created_at desc)` index to grab the most recent page in one
index-range scan, and keyset pagination (`created_at < oldestSeen`) loads older
pages without `OFFSET` drift. Reversing the 30-row page in memory is trivial and
gives the conventional bottom-anchored chat layout. This keeps both "newest-first
persistence/ordering" (satisfying the requirement) and natural reading order.

---

## 7. Live delivery — Supabase Realtime via Postgres Changes

For the MVP, new messages are pushed to the other participant using **Postgres
Changes** (the `postgres_changes` Realtime feature), scoped to a single
conversation channel.

### 7.1 Enable replication (one-time setup)

```sql
-- Add messages to the realtime publication so INSERTs are streamed.
alter publication supabase_realtime add table public.messages;
```

> **Note:** INSERT delivery needs only the table in the publication with
> `messages`' **`REPLICA IDENTITY` left at its `DEFAULT`** (the full new row is
> streamed, which is all an append-only chat needs; `FULL` would only matter for
> UPDATE/DELETE old-value payloads). And the subscriber **must** use the
> **authenticated** browser client so its **session JWT is passed to the Realtime
> socket** — that JWT is what lets Postgres-Changes evaluate `messages` RLS per
> subscriber (§7.2).

### 7.2 Client subscription hook

```ts
// lib/realtime/use-conversation-messages.ts
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import type { Message } from '@/types';

export function useConversationMessages(conversationId: string, initial: Message[]) {
  const [messages, setMessages] = useState<Message[]>(initial);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`messages:conversation_${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          // de-dupe in case our own optimistic insert already added it
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming],
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return messages;
}
```

**RLS auto-applies:** Postgres Changes evaluates each candidate row against the
subscriber's RLS policies on `public.messages` before delivering it. Because the
SELECT policy (owned by `02-rls-and-security.md`) only exposes messages in
conversations where the subscriber's team is a participant, a client **cannot**
receive messages for a conversation it does not belong to — even though the
client-supplied `filter` is just `conversation_id=eq.<id>`. The `filter` is a
performance/relevance narrowing, **not** the security boundary; RLS is. For
Realtime to apply per-user RLS the client must be using the authenticated
Supabase client (the session JWT is passed to the Realtime server).

**Why channel topic `messages:conversation_<id>`:** scoping the channel to one
conversation means each open thread subscribes to exactly the stream it needs.
The fan-out is tiny (two teams), so per-conversation channels keep payloads
relevant and teardown clean when the user leaves the thread.

**Why Postgres Changes over Broadcast for the MVP:**

| | Postgres Changes (chosen) | Broadcast-from-DB (scale path) |
|---|---|---|
| RLS | **Automatic** — table RLS filters delivery | Manual — needs RLS on `realtime.messages` + `private:true` |
| Setup | Add table to publication; subscribe | DB trigger calls `realtime.broadcast_changes()`; topic auth policies |
| Fan-out cost | Each subscriber's RLS re-evaluated per change | Cheaper at high subscriber counts |
| Best for | Small, tightly-scoped fan-out (our 2-team threads) | Many subscribers per topic / high write rates |

> **Why:** Postgres Changes "just works" with our existing table RLS — no
> separate authorization surface, minimal config — which is exactly right for a
> two-participant conversation. Broadcast-from-DB scales better (it decouples
> delivery from per-row RLS re-evaluation) but adds an authorization surface
> (`realtime.messages` RLS, `private: true` channels, a DB trigger emitting the
> broadcast). We **document Broadcast as the scale path only** and do not build
> it for the 3-day MVP.

### 7.3 Sending from the thread UI

```tsx
// components/message-composer.tsx
'use client';
import { useActionState } from 'react';      // React 19 — not useFormState
import { sendMessage } from '@/actions/messages';

export function MessageComposer({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(sendMessage, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <textarea name="content" required maxLength={4000} />
      <button disabled={pending}>Send</button>
      {state && !state.success && <p role="alert">{state.message}</p>}
    </form>
  );
}
```

The composer calls the Server Action (the write path); the new row arrives back
through the Realtime subscription (the read path). The sender sees their own
message via Realtime too — the de-dupe guard in the hook prevents a double-render
if optimistic UI is added later. `useActionState` supplies the implicit
`startTransition`, so no manual transition wiring is needed.

---

## 8. Sequence diagram — start conversation + live delivery

```mermaid
sequenceDiagram
    autonumber
    actor MA as Member of Team A
    participant UIA as Team A Client
    participant SA as Server Action
    participant DB as Postgres (RLS)
    participant RT as Realtime (Postgres Changes)
    participant UIB as Team B Client (thread open)

    Note over MA,DB: Start a conversation (idempotent)
    MA->>UIA: click "Message Team B"
    UIA->>SA: getOrCreateConversation(targetTeamId=B)
    SA->>SA: myTeam=A from JWT; reject if A==B; sort -> (a<b)
    SA->>DB: upsert conversations ON CONFLICT(team_a,team_b) DO NOTHING
    DB-->>SA: ok (inserted or pre-existing)
    SA->>DB: select id where (team_a,team_b)
    DB-->>SA: conversationId
    SA-->>UIA: { success, conversationId }
    UIA->>UIA: navigate to /messages/{conversationId}

    Note over UIA,UIB: Both threads subscribe to messages:conversation_<id>
    UIA->>RT: subscribe (filter conversation_id=eq.id)
    UIB->>RT: subscribe (filter conversation_id=eq.id)

    Note over MA,UIB: Send + live receive
    MA->>UIA: type + submit message
    UIA->>SA: sendMessage(conversationId, content)
    SA->>SA: membership check (A in {team_a,team_b})
    SA->>DB: insert messages(sender_team_id=A, ...)
    DB-->>SA: ok
    DB-->>RT: WAL INSERT on public.messages
    RT->>RT: evaluate messages RLS per subscriber
    RT-->>UIB: deliver new row (B is a participant) ✔
    RT-->>UIA: deliver new row (A is a participant; de-duped)
    UIB->>UIB: append message to thread (live)
```

---

## 9. File / module layout

```
app/
  (app)/messages/
    page.tsx                     # inbox: RPC get_inbox, server-rendered, newest-first
    [conversationId]/
      page.tsx                   # thread: initial messages (DESC) + composer
      thread-client.tsx          # 'use client' wrapper: useConversationMessages hook
actions/
  messages.ts                    # getOrCreateConversation + sendMessage (top-level, 00 §6.5)
utils/supabase/{server,client}.ts          # owned by 03-auth-and-session.md
lib/
  realtime/use-conversation-messages.ts    # Postgres Changes subscription hook
  constants.ts                              # TAGS cache-tag registry — owned by 08 §3.6
  auth/claims.ts                            # getCurrentTeamId() — owned by 03
components/
  message-composer.tsx           # useActionState form
  conversation-list-item.tsx
```

**Why Server Actions for both mutations (not Route Handlers):** Next 15 favors
Server Actions for mutations — they colocate with the component, integrate with
`useActionState`/`startTransition`, and avoid hand-written fetch + endpoint
boilerplate. Realtime handles the read/live side, so no API route is needed.

---

## 10. Edge cases & how they're handled

| Case | Handling |
|---|---|
| Team messages itself | Server Action self-check **and** `CHECK (team_a_id < team_b_id)` make `{A,A}` impossible |
| Two simultaneous "start" clicks | `ON CONFLICT DO NOTHING` + `UNIQUE` → one row; both callers re-select it |
| Member of a non-participant team forges `conversationId` | Membership check returns a clean error; RLS rejects the INSERT regardless |
| Forged `sender_team_id` in the request | Impossible — never read from the client; RLS rejects mismatched sender |
| Empty / oversized message | Zod (`min(1).max(4000)`) + DB `CHECK (char_length between 1 and 4000)` |
| Subscriber tries to listen to another team's thread | Realtime applies `messages` RLS per row → no delivery |
| Conversation with no messages yet | `LEFT JOIN LATERAL` returns `NULL` timestamp; `nulls last` keeps it sorted below active threads |

---

## 11. Known limitations / what-to-improve-with-more-time

- **No read receipts / unread counts** — would add a `message_reads` table or a
  per-participant `last_read_at`; out of scope for the MVP.
- **No typing indicators / presence** — would use Realtime Presence; deferred.
- **Inbox liveness** — the open thread is live, but the inbox ordering refreshes
  on navigation/`revalidateTag`, not push. A small Realtime subscription on the
  inbox (or the Broadcast scale path) would make it live too.
- **Group (>2 team) conversations** — the sorted-pair model is intentionally 1:1;
  groups would need a `conversation_participants` join table and a different
  ordering/uniqueness scheme.
- **Scale path for delivery** — migrate Postgres Changes → Broadcast-from-DB with
  `realtime.broadcast_changes()` + topic RLS once per-topic subscriber counts or
  write rates grow (see §7.2 table).
- **Scale path for inbox reads** — denormalize `conversations.last_message_at`
  via an `AFTER INSERT` trigger if read volume dominates writes (see §5.1 Why).
```
