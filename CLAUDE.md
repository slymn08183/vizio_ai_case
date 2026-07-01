# CLAUDE.md — Operating rules for this repo (team-based social MVP)

> Checked-in agentic ruleset. Encodes the locked decisions and the concrete bugs a
> prior AI draft shipped, so any agent editing this repo re-reads them every turn
> and cannot regress them. (Companion: `docs/plan/` is the durable design;
> `docs/plan/00-overview.md` is authoritative; `docs/plan/CONTRACTS.md` pins shared
> interfaces.)

## Product invariants (NEVER violate)
- **Tenant = Team.** Each auth user belongs to EXACTLY ONE team. There are NO
  individual profiles; every post/follow/message acts under the team identity.
- **Roles are OUT OF SCOPE.** Do not add roles/permissions tables.
- Teams are **Public or Private**. Public ⇒ followable instantly (`status='approved'`).
  Private ⇒ a follow is a `'pending'` REQUEST the target approves/rejects.
- Follow & messaging are **TEAM↔TEAM**. A team can never follow/message itself.

## Locked technical decisions (do not relitigate)
- Stack: **Next.js 15 App Router + Supabase**, our own minimal setup (NOT MakerKit).
- **Security lives in the DATABASE via RLS.** App code is never the security boundary.
- Active `team_id` + `onboarded` are injected into the JWT under **`app_metadata`** by a
  **Custom Access Token Auth Hook** (race-free; present on the first token). The
  `auth.users` trigger ONLY creates team+profile transactionally — it MUST NOT write
  `raw_app_meta_data`.
- **Realtime is messaging-ONLY** (Postgres Changes). The home feed uses Server Action
  revalidation (`revalidateTag`) + a poll-based "new posts" pill.
- Mutations are **Server Actions** (not Route Handlers), validated with **Zod**.
- Deploy: **Vercel** + Supabase cloud.

## Hard coding rules
- Next 15: the server Supabase client is async — ALWAYS `await createClient()`
  (`@/utils/supabase/server`); `cookies()`/`headers()`/route `params` are async too.
- Middleware auth gate uses `supabase.auth.getUser()` (network-fresh). Routing values
  (`team_id`, `onboarded`) come from `getClaims()` at `app_metadata.*`.
- Feature code reads the acting team ONLY via `getCurrentTeamId()` /
  `requireCurrentTeamId()` (`@/lib/auth/claims`) — never `getUser().app_metadata`.
- **Never set `posts.team_id`** (DB default `current_user_team_id()`) or `posts.is_public`
  (BEFORE INSERT trigger). **Always set `messages.sender_team_id`** (no default; RLS
  requires it equals the acting team).
- get-or-create conversation: `upsert(..., { onConflict:'team_a_id,team_b_id', ignoreDuplicates:true })`,
  with the pair stored `team_a_id < team_b_id`. NEVER a bare `.insert()` (throws 23505).
- `follows`: ONE table with `status` enum. Approve/reject updates the `status` column
  ONLY (column-level GRANT + RLS); the action sets status (public⇒approved, private⇒pending),
  RLS `WITH CHECK` is the hard guard. No status-forcing DB trigger exists.
- Idempotent writes via `ON CONFLICT DO NOTHING` / `upsert`, not `try/catch` on 23505.
- Every form-driven Server Action returns `ActionState = { success, message, errors? }`
  (`@/lib/types`); client forms use React 19 `useActionState` (NOT `useFormState`).
- After a successful mutation, `revalidateTag(TAGS.*)` / `revalidatePath` — only tags from
  `@/lib/constants` `TAGS`, never raw strings.

## Shared naming (authoritative — copy exactly)
```
teams(id,name,is_public,onboarded,created_at)
profiles(id->auth.users, team_id->teams, email, created_at)
posts(id, team_id->teams DEFAULT current_user_team_id(), content, is_public, created_at)
follows(follower_team_id, following_team_id, status follow_status, created_at,
        pk(follower_team_id,following_team_id))
conversations(id, team_a_id, team_b_id, created_at, unique(team_a_id,team_b_id), check a<b)
messages(id, conversation_id, sender_team_id, content, created_at)
helpers: public.current_user_team_id(),
         public.check_team_follows(_follower_team_id,_following_team_id),
         public.get_feed(_viewer_team_id,_cursor,_limit),
         public.get_inbox(_viewer_team_id),
         public.get_incoming_follow_requests(_viewer_team_id)
migrations: 0001_extensions → 0002_tables → 0003_indexes → 0004_helpers → 0005_rls
            → 0006_triggers → 0007_auth_hook ; data in supabase/seed.sql
```

## Definition of done for any change
1. `pnpm typecheck` clean and `pnpm build` succeeds.
2. `supabase db test` (pgTAP/RLS) green when DB-affecting.
3. New tables/policies ship with a matching pgTAP RLS assertion.
4. SECURITY DEFINER functions `set search_path = ''` AND verify the caller's team.

## Self-review pass (run before declaring done)
Re-read the diff as an adversary. For every RLS policy: "what does `anon` see? what does
Team B see?" For every SECURITY DEFINER function: "can a caller pass another team's id?"
Prefer writing a failing test first, then fixing.
