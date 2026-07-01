# CONTRACTS — pinned interfaces for parallel feature implementation

> This file is the integration contract for the 5 feature domains built in
> parallel. The foundation (scaffold, SQL migrations, Supabase clients,
> middleware, auth, onboarding, shared UI kit) is **already built**. Each domain
> agent reads its own plan file (`04`–`07` + `00` §7) for internal detail, but
> **all shared boundaries below are FIXED — do not invent variants.**

## 0. Already-built foundation (import, do not recreate)

```
utils/supabase/client.ts     → createClient()            (browser)
utils/supabase/server.ts     → async createClient()       (RSC/actions; MUST await)
utils/supabase/anon.ts       → createAnonClient()         (cookie-less, for cached public reads)
lib/auth/claims.ts           → getCurrentTeamId(): Promise<string|null>
                               requireCurrentTeamId(): Promise<string>  (throws if none)
lib/constants.ts             → TAGS, LIMITS, FEED_PAGE_SIZE
lib/types.ts                 → Team, Post, Follow, Conversation, Message,
                               FeedItem, InboxItem, IncomingFollowRequest,
                               ActionState, EMPTY_ACTION_STATE
lib/utils.ts                 → cn(), timeAgo(iso), initials(name)
components/ui.tsx            → Button, LinkButton, Card, Badge, Avatar, EmptyState,
                               Field, buttonClasses(), inputClasses, textareaClasses
components/submit-button.tsx → SubmitButton  ("use client"; use inside any <form>)
```

Auth state in an RSC/action: `const { data:{ user } } = await (await createClient()).auth.getUser();`
Acting team: `const teamId = await getCurrentTeamId();` (or `requireCurrentTeamId()` in actions).

## 1. Global conventions

- **Imports:** always `@/...` (root alias). Server client import is **`@/utils/supabase/server`** (never `@/lib/supabase/...`).
- **Server Actions live in top-level `actions/<domain>.ts`** with `"use server"` at top.
- **Action result:** mutation actions consumed by a form use
  `(_prev: ActionState, formData: FormData): Promise<ActionState>` and return
  `{ success, message, errors? }` (import `ActionState`, `EMPTY_ACTION_STATE`).
  Actions that only navigate may be `(formData: FormData): Promise<void>` and call `redirect()`.
- **Validation:** Zod `safeParse(Object.fromEntries(formData))` inside the action; on failure return `{ success:false, message:'Invalid input', errors: parsed.error.flatten().fieldErrors }`.
- **Never set `team_id` on a post** (DB default + trigger). **Always set `sender_team_id` on a message** (no default; RLS requires `= current team`).
- **Caching:** only the cache tags in `TAGS` — no raw strings. Post created → `revalidateTag(TAGS.publicFeed)` + `revalidatePath('/')`. Follow/approve/reject → `revalidatePath('/teams')`, `revalidatePath('/requests')`, `revalidatePath('/')`. Message sent → `revalidatePath('/messages')` + `revalidatePath(\`/messages/${conversationId}\`)`.
- **Styling:** dark theme via the UI kit + Tailwind tokens (`bg-surface`, `text-muted`, `border-border`, `text-primary`, etc.). Reuse `Card`, `Button`, `Avatar`, `EmptyState`, `Field`, `inputClasses`, `textareaClasses`. Keep it clean and minimal.
- **`"use client"`** only on components using hooks/events. Pages/cards stay server components where possible.
- All timestamps are ISO strings; render with `timeAgo()`.

## 2. RPC + query reference (exact)

```ts
// Authenticated private-feed slice (NOT public):
supabase.rpc('get_feed', { _viewer_team_id: teamId, _cursor: cursorIsoOrNull, _limit: FEED_PAGE_SIZE }) // → FeedItem[]
// Inbox, newest-first, counterpart name surfaced even if private:
supabase.rpc('get_inbox', { _viewer_team_id: teamId }) // → InboxItem[]
// Pending incoming follow requests, requester name surfaced even if private:
supabase.rpc('get_incoming_follow_requests', { _viewer_team_id: teamId }) // → IncomingFollowRequest[]

// Public feed slice (anon-readable). Embed team name; map teams.name → team_name:
anon.from('posts').select('id, team_id, content, is_public, created_at, teams(name)')
    .eq('is_public', true).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(FEED_PAGE_SIZE)
```

## 3. Domain ownership & cross-domain interfaces

### A — Posting (plan 04). Files:
- `actions/posts.ts` → `createPost(_prev: ActionState, formData: FormData): Promise<ActionState>`
  (insert `{ content }` only; `revalidateTag(TAGS.publicFeed)` + `revalidatePath('/')`; success → `{success:true,message:'Posted'}`).
- `components/composer.tsx` (`"use client"`) → `export function Composer()` — textarea + `SubmitButton`, `useActionState(createPost, EMPTY_ACTION_STATE)`, clears on success. No props (acts as current team).
- `components/post-card.tsx` → `export function PostCard({ post }: { post: FeedItem })` — **presentational, server component**. Renders `Avatar(post.team_name)`, team name, `timeAgo(post.created_at)`, a `Badge` (`public`→tone "public" label "Public", else tone "private" label "Private"), and `post.content`. **Other domains import this.**

### B — Feed (plan 07). Files:
- `app/page.tsx` — home feed (anon + authed). Public slice via `unstable_cache(fn, [key], { tags:[TAGS.publicFeed] })` using `createAnonClient()` (map `teams.name`→`team_name`). If authed+onboarded: also `rpc('get_feed', …)` for the private slice. Merge (disjoint by `is_public`), sort `created_at desc, id desc`, render `PostCard[]`. Show `<Composer/>` only when authed+onboarded. Logged-out still renders public posts. Empty → `EmptyState`.
- `actions/feed.ts` → `countNewerPosts(sinceIso: string): Promise<number>` (count public posts with `created_at > sinceIso`; used by the pill).
- `components/new-posts-pill.tsx` (`"use client"`) → polls `countNewerPosts` (~15s) given the newest visible `created_at`; shows "N new posts" → `router.refresh()`.
- **Imports `PostCard` and `Composer` from domain A** (build against the signatures above).

### C — Follow (plan 05). Files:
- `actions/follows.ts` → all `(_prev: ActionState, formData: FormData): Promise<ActionState>`, teamId via hidden input:
  - `followTeam` (read target `teams.is_public`: visible ⇒ insert `status:'approved'`; else insert `status:'pending'`. The client never approves a private follow — RLS `WITH CHECK` is the hard guard).
  - `unfollowTeam` (delete own edge), `approveFollowRequest` (update status `'approved'` where `follower_team_id`=input AND `following_team_id`=me), `rejectFollowRequest` (update status `'rejected'`).
  - Each revalidates `/teams`, `/requests`, `/`.
  - **NOTE: there is no DB status-forcing trigger — the action sets `status`; RLS enforces correctness.**
- `app/requests/page.tsx` — server component; `rpc('get_incoming_follow_requests',…)` → list with `<RequestActions/>`. Empty → `EmptyState`.
- `components/follow-button.tsx` (`"use client"`) → `export function FollowButton({ teamId, isPublic, initialStatus }: { teamId:string; isPublic:boolean; initialStatus:'none'|'pending'|'approved' })`. Renders Follow / Requested / Following(+unfollow) via `useActionState`. **Teams page (domain E) imports this.**
- `components/request-actions.tsx` (`"use client"`) → `export function RequestActions({ followerTeamId }: { followerTeamId:string })` — Approve / Reject buttons.

### D — Messaging (plan 06). Files:
- `actions/messages.ts`:
  - `getOrCreateConversation(formData: FormData): Promise<void>` — read `teamId`; reject self (`teamId===myTeam`); order pair `[a,b]=[min,max]`; `upsert({team_a_id:a, team_b_id:b}, { onConflict:'team_a_id,team_b_id', ignoreDuplicates:true })`; then fetch the row id; `redirect('/messages/'+id)`.
  - `sendMessage(_prev: ActionState, formData: FormData): Promise<ActionState>` — read `conversationId`+`content`; set `sender_team_id = requireCurrentTeamId()`; insert; `revalidatePath('/messages')` + `revalidatePath('/messages/'+conversationId)`; return success.
- `app/messages/page.tsx` — inbox; `rpc('get_inbox',…)` → list newest-first (`other_team_name`, `last_message` preview, `timeAgo(last_message_at)`), each links to `/messages/[conversation_id]`. Empty → `EmptyState` (hint: start a conversation from the Teams page).
- `app/messages/[conversationId]/page.tsx` — `params` is a **Promise** in Next 15 (`const { conversationId } = await params`). Verify membership by selecting the conversation (RLS returns it only to participants; if missing → `notFound()`). Load messages `order('created_at', {ascending:true})`. Resolve counterpart name (use `get_inbox` or a teams read). Render `<MessageThread/>`.
- `components/message-thread.tsx` (`"use client"`) → `export function MessageThread({ conversationId, myTeamId, otherTeamName, initialMessages }: { conversationId:string; myTeamId:string; otherTeamName:string; initialMessages: Message[] })`. Subscribes to Postgres Changes (`createClient()` browser) on `messages` filtered `conversation_id=eq.<id>`, appends inserts (dedupe by id), renders bubbles (own = `sender_team_id===myTeamId`, right-aligned/primary), auto-scrolls, and includes the send composer (`useActionState(sendMessage)`; clears on success).

### E — Teams browse (plan 00 §7). Files:
- `app/teams/page.tsx` — server component. `createClient()` authed; `from('teams').select('*')` (RLS returns public teams + own). Read own follow edges: `from('follows').select('following_team_id,status').eq('follower_team_id', myTeam)` → map to status per team. For each team **except own**, a `Card` with `Avatar`, name, public/private `Badge`, `<FollowButton teamId isPublic initialStatus/>` (domain C), and a Message `<form action={getOrCreateConversation}>` with hidden `teamId` + `SubmitButton` (domain D). Own team shows an "(your team)" marker, no buttons. Empty → `EmptyState`.
- **Imports `FollowButton` (C) and `getOrCreateConversation` (D).**

## 4. Next 15 reminders
- `cookies()`, `headers()`, and route `params`/`searchParams` are **async** — await them.
- Server client factory is async — `const supabase = await createClient()`.
- `useActionState` (React 19) returns `[state, action, pending]`; `SubmitButton` reads `useFormStatus` so it must be a child of the `<form>`.
- Realtime requires the `messages` table added to the `supabase_realtime` publication (documented in README; Postgres Changes respects the SELECT RLS as the delivery ACL).
