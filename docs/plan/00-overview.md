# 00 — Master Plan, Canonical Decisions & Review Reconciliation

> **This document is authoritative.** The plan was produced by a fleet of domain planners (`01`–`09`) and then adversarially reviewed by three independent critics (coverage / consistency / correctness). Where any detail in `01`–`09` conflicts with this file, **this file wins** — it records the single canonical resolution for every divergence the review found, with corrected SQL/TS inline. Implement against `00` + the domain files together.

---

## 1. How to read the plan

| File | Owns |
|---|---|
| `00-overview.md` | **(this)** master index, locked decisions, tech rationale, coverage matrix, canonical reconciliations |
| `01-data-model.md` | Postgres DDL, constraints, indexes, ERD, helper signatures, migration order |
| `02-rls-and-security.md` | RLS policies, `SECURITY DEFINER` helpers, `get_feed`/RPC security envelopes, GRANTs, RLS summary |
| `03-auth-and-session.md` | Supabase clients, email+OAuth, Auth Hook, provisioning trigger, middleware, onboarding |
| `04-posting.md` | create-post action, composer/feed-card UI, optimistic update |
| `05-follow-system.md` | follow/unfollow/request/approve/reject actions, requests inbox |
| `06-messaging.md` | get-or-create conversation, send, inbox ordering, Postgres-Changes realtime |
| `07-home-feed.md` | dynamic route, two-slice feed (public cache + private RPC), keyset pagination, "new posts" pill |
| `08-architecture.md` | system diagram, folder structure, action/error conventions, README spine, risks/trade-offs |
| `09-ai-blueprint-and-quality.md` | AI Engineering Blueprint, pgTAP testing, Vercel deploy runbook |

---

## 2. Locked decisions (do not relitigate)

1. **Own minimal Next.js 15 (App Router) + Supabase** — *not* MakerKit. MakerKit's account/billing/role model fights the one-user-one-team / no-profiles model and the "no over-abstraction" criterion.
2. **Tenant = Team.** Each user belongs to exactly one team; no individual profiles; every action is under the team identity; roles out of scope.
3. **Security at the DB layer via RLS.** App code is a convenience layer, never the security boundary.
4. **Active `team_id` lives in the JWT under `app_metadata`,** injected by a **Custom Access Token Auth Hook** (race-free: present on the first token).
5. **Realtime only for messaging** (Supabase Postgres Changes). The home feed uses **Server Action revalidation** (`revalidateTag`) + a poll-based "new posts" pill. A realtime feed is a deferred stretch goal.
6. **Deploy: Vercel** (+ Supabase cloud).

---

## 3. Technology choices & rationale ("neden bu teknoloji")

| Choice | Why (1-liner) |
|---|---|
| **Next.js 15 App Router** | RSC + Server Actions give one secure server boundary for data + mutations; required by the case. |
| **Supabase (Postgres + Auth + Realtime)** | One platform for auth, relational data with RLS, and websockets — minimal moving parts for a 3-day MVP; required by the case. |
| **Postgres RLS as the security boundary** | Authorization lives next to the data, so any path (RSC, action, direct API) is equally protected — can't be bypassed by an app bug. |
| **JWT `app_metadata.team_id` + Custom Access Token Auth Hook** | Stateless tenant resolution: RLS reads the team from the verified token with zero DB round-trips; the hook guarantees the claim on the *first* token (no refresh dance). `app_metadata` is server-only (not client-writable, unlike `user_metadata`). |
| **`SECURITY DEFINER` helper fns + `get_feed`/`get_inbox` RPCs** | Break the posts↔follows RLS recursion and collapse multi-table visibility joins into one fast (<5ms) call, while table RLS stays on as defense-in-depth. |
| **`TO anon` vs `TO authenticated` split policies** | Keeps the private-team predicate entirely out of the anonymous query plan, so a logged-out visitor can *never* be served private content. |
| **Denormalized `posts.is_public`** | The anon public-feed scan needs no `teams` join; kept correct by triggers. |
| **Single `follows` table + `status` enum** | A request and an approved follow are one relationship at different lifecycle stages → one source of truth, approve = a single `UPDATE`. |
| **Symmetric `conversations` (`team_a_id < team_b_id` + UNIQUE)** | Maps each unordered team pair to exactly one row → race-safe get-or-create via `upsert(... ignoreDuplicates)`; strict `<` also forbids self-conversations. |
| **Postgres Changes (not Broadcast) for chat** | Auto-respects the `messages` SELECT RLS as the delivery ACL with near-zero setup; the 2-team fan-out doesn't need Broadcast's scale. |
| **Lateral-join inbox ordering (not denormalized `last_message_at`)** | Zero write-amplification and always correct for MVP volume; denormalization is documented as the scale path. |
| **Server Actions + Zod + `useActionState`** | Colocated, type-safe mutations with one validated, untrusted-input boundary; no bespoke API client. |
| **`revalidateTag` (not `revalidatePath`)** | Surgically purges only affected cached data across routes; avoids blowing the whole router cache. |
| **Keyset/cursor pagination** | Stable under inserts (no page-2 duplicates that `OFFSET` causes) and index-friendly. |
| **pgTAP via `supabase db test` + basejump helpers** | Verifies RLS in milliseconds with `authenticate_as` + `BEGIN/ROLLBACK` — far higher ROI than slow/flaky E2E for a security-centric case. |
| **Vercel** | First-class Next.js host; trivial Supabase env wiring; gives the optional live-link signal. |

---

## 4. Case-scope coverage matrix (proves 100%)

| # | Case requirement | Covered in | Notes |
|---|---|---|---|
| 1 | Auth: email+password | `03` §1,§3 | Supabase Auth |
| 1 | Auth: Google OAuth (PKCE) | `03` §3,§7 | `/auth/callback` exchange |
| 1 | Persistent session | `03` §2,§6 | `@supabase/ssr` cookies + middleware refresh |
| 1 | Clear logged-in vs logged-out | `03` §10 + **§7 below** | authed shell vs public top-bar + Sign-in CTA |
| 1 | User↔team association after login | `03` §5,§10 | `team_id` claim + "Acting as {team}" badge |
| 2 | One user → exactly one team | `01` §4.2 | `profiles.id` PK=FK, single `team_id` |
| 2 | Public/Private teams | `01` §4.1, `02` §6.1 | `teams.is_public` |
| 2 | Content scoped to team | `02` (all policies) | RLS `= current_user_team_id()` |
| 2 | Team seeded at signup | `03` §4 | `handle_new_user` trigger |
| 3 | Any member can post | `04` §1, `02` §6.3 | INSERT `WITH CHECK team_id = current_user_team_id()` |
| 3 | Posts team-owned, text + created_at | `01` §4.3, `04` | `posts(team_id, content, created_at)` |
| 4 | No self-follow / one-directional | `01` §4.4 | `CHECK(follower<>following)`, no sorting invariant |
| 4 | Public = immediate; Private = request→approve/reject | `05` §3-§4, `02` §6.4 | `status` enum + privacy guard |
| 4 | Follow/unfollow + store requests | `05` §4, `01` §4.4 | single `follows` table |
| 5 | Team↔team messaging, any member, no self | `06` §2-§4, `01` §4.5 | symmetric `conversations` |
| 5 | Start / send / receive / newest-first / persist | `06` §3-§5 | lateral-join inbox order |
| 6 | Public posts to all incl. **unauthenticated** | `07` §6, `02` §5 | `TO anon USING(is_public=true)` |
| 6 | Private posts only to approved followers | `07` §4, `02` §7 | `get_feed` private slice |
| 6 | Newest-first | `07` §5 | keyset `created_at desc, id desc` |
| 7 | RLS scoping + private enforcement, explained | `02` (whole) | per-table matrix + RLS summary |
| 8 | README: architecture, ERD, trade-offs, risks | `08` §1,§10,§11 + `01` ERD | |
| 9 | Clean async/error, folder structure, readable | `08` §2-§3 + `04`-`07` actions | standardized `{success,message,errors?}` |
| D | README deliverable | `08` §10 | spine + sections |
| D | **AI Engineering Blueprint** | `09` §A | tools, workflow, rulesets, review story |
| D | Optional Vercel deploy | `09` §C | runbook |
| D | Optional video | — | script outline in `08`/`09`; optional |

---

## 5. Review summary

Three critics reviewed all nine files. **Coverage:** all functional requirements addressed; one substantive functional gap (team-name visibility) + minor product-UX gaps. **Consistency:** 10 findings (mostly "which file is canonical" drift). **Correctness:** 11 findings; the 6 prior corrections were verified present, but a cluster of integration defects would block running. All real findings are resolved canonically below.

Severity tally (deduped): **4 high (app-breaking)**, **8 medium (consistency/compile)**, **9 low (naming/polish)**.

---

## 6. Canonical reconciliations (authoritative fixes)

### 6.1 — Auth claim path + Auth Hook access *(HIGH ×2)*

**Canonical: the team_id/onboarded claims live under `app_metadata`, and every reader uses that exact path.** The hook runs as `supabase_auth_admin`, so with RLS enabled it needs explicit read access.

```sql
-- (A) Let the hook's role read the tables under RLS. GRANT alone is NOT enough while RLS is on.
grant usage on schema public to supabase_auth_admin;
grant select on public.profiles, public.teams to supabase_auth_admin;
create policy auth_admin_read_profiles on public.profiles
  for select to supabase_auth_admin using (true);
create policy auth_admin_read_teams on public.teams
  for select to supabase_auth_admin using (true);

-- (B) Hook writes claims UNDER app_metadata (matches current_user_team_id() + middleware).
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  claims    jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_team_id uuid;
  v_onboarded boolean;
begin
  select p.team_id, t.onboarded into v_team_id, v_onboarded
  from public.profiles p
  join public.teams t on t.id = p.team_id
  where p.id = (event ->> 'user_id')::uuid;

  if not (claims ? 'app_metadata') then            -- ensure parent object exists for jsonb_set
    claims := jsonb_set(claims, '{app_metadata}', '{}'::jsonb);
  end if;
  if v_team_id is not null then
    claims := jsonb_set(claims, '{app_metadata,team_id}', to_jsonb(v_team_id));
  end if;
  claims := jsonb_set(claims, '{app_metadata,onboarded}', to_jsonb(coalesce(v_onboarded, false)));

  return jsonb_set(event, '{claims}', claims);
end;
$$;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
```

```sql
-- (C) The RLS resolver reads the SAME path. (No table access → SECURITY DEFINER not required.)
create or replace function public.current_user_team_id()
returns uuid language sql stable set search_path = '' as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'team_id', '')::uuid
$$;
```

- **Middleware & app code** read claims via `supabase.auth.getClaims()` at `claims.app_metadata.team_id` / `claims.app_metadata.onboarded`.
- **Never** read `getUser().app_metadata.team_id` in feature code — the provisioning trigger deliberately does **not** write `raw_app_meta_data` (correction #3), so that field is empty; the value lives only in the token. Use the shared helper below.

```ts
// lib/auth/claims.ts — the ONE way feature code gets the acting team. (owner: 03)
import { createClient } from '@/utils/supabase/server';

export async function getCurrentTeamId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims as any)?.app_metadata?.team_id ?? null;
}
```

`05`, `06`, `07` all call `getCurrentTeamId()`. This supersedes `user.app_metadata.team_id` (05/07) and the undefined `@/lib/auth/claims` reference (06).

### 6.2 — `posts.team_id` must default to the acting team *(HIGH)*

```sql
-- 01 §4.3 canonical column:
team_id uuid not null references public.teams(id) on delete cascade
  default public.current_user_team_id(),
```

So `insert({ content })` is valid; the `WITH CHECK (team_id = current_user_team_id())` policy re-validates it and the client can never spoof `team_id`. (Depends on §6.1 so the function resolves.)

### 6.3 — `get_feed` single canonical contract *(HIGH)*

**Canonical: `get_feed` returns the PRIVATE slice only** (own-team private + approved-followed private), **with `team_name`**, as a typed table. Public posts come exclusively from the cached public slice → the two slices are disjoint by `is_public`, so the merge needs no de-dup.

```sql
create or replace function public.get_feed(
  _viewer_team_id uuid,
  _cursor timestamptz default null,
  _limit  int default 20
)
returns table (id uuid, team_id uuid, team_name text, content text, is_public boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
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
grant execute on function public.get_feed(uuid, timestamptz, int) to authenticated;  -- NOT anon
```

- **01 §7** signature updated to this exact shape. **02 §7** keeps only the security-envelope description and points here for the body. **07 §4** uses this body.
- **Public slice** (`07` getPublicSlice, and the anon path) selects `id, team_id, content, is_public, created_at` **plus the team name** via PostgREST embed `teams(name)` (public teams' names are RLS-readable). Both slices therefore carry `team_name`, so `PostCard` (04 §6) renders correctly.

### 6.4 — Team-name visibility for private counterparts *(HIGH, coverage gap)*

`teams` SELECT RLS stays strict (`is_public OR id = current_user_team_id()`). Names of **private** counterpart teams are surfaced only through `SECURITY DEFINER` RPCs (which bypass RLS in a controlled, audited way):

- **Feed:** `get_feed` returns `team_name` (§6.3).
- **Inbox:** `get_inbox(_viewer_team_id)` returns the counterpart `team_name`, last message, and `last_message_at`.
- **Follow requests:** `get_incoming_follow_requests(_viewer_team_id)` returns the requester `team_name` + `created_at`.

Add these signatures to **01 §7** and the helpers migration (**08** `0004_helpers.sql`):

```sql
get_inbox(_viewer_team_id uuid)
  returns table (conversation_id uuid, other_team_id uuid, other_team_name text,
                 last_message text, last_message_at timestamptz);
get_incoming_follow_requests(_viewer_team_id uuid)
  returns table (follower_team_id uuid, follower_team_name text, created_at timestamptz);
```

Both are `SECURITY DEFINER`, `SET search_path=''`, with the same `_viewer_team_id = current_user_team_id()` guard, `EXECUTE` granted to `authenticated` only.

### 6.5 — Naming & structure (canonical values) *(MED/LOW)*

| Concern | Canonical | Fix where it differs |
|---|---|---|
| Supabase server client import | `@/utils/supabase/server` | 04/05/06/07 (drop `@/lib/supabase/server`) |
| Server Actions folder | `actions/<domain>.ts` (top-level) | 04 (`lib/actions`), 05 (`src/lib/actions`), 06 (`app/_actions`) |
| Home feed route | root `app/page.tsx` (anon-reachable; in middleware `PUBLIC` set) | 04 §2 (`(app)/feed`) |
| Onboarding route | `app/onboarding/page.tsx` (outside `(app)` group) | 08 (`(app)/onboarding`) |
| Poll-count action | `countNewerPosts` in `actions/feed.ts` | 08 (`checkNewPosts`) |
| `follows` policies | defined once in **02** (names + INSERT privacy guard); 05 references, does not re-declare | 05 |
| `conversations` constraints | `conversations_canonical_order`, `conversations_unique_pair` | 06 (restate 01's names) |
| `posts` is_public trigger | `posts_set_is_public_before_insert` | 04 (restate 01's name) |
| `get_inbox` owner | declared in **01 §7**, implemented per 06 | — |

**Cache-tag registry (08 §3.6) — single source, keyed where noted:**
```ts
export const TAGS = {
  publicFeed: 'public_feed',
  teamFollows: (teamId: string) => `team_follows:${teamId}`,
  teamInbox:   (teamId: string) => `inbox:${teamId}`,
} as const;
```
Producers (RSC fetches) and consumers (actions) must use the **same** string: `05` approve/reject → `revalidateTag(TAGS.teamFollows(teamId))`; `06` send → `revalidateTag(TAGS.teamInbox(teamId))`; `04`/`07` post → `revalidateTag(TAGS.publicFeed)` (public posts) and the private slice is dynamic (no tag needed). No raw tag strings anywhere.

### 6.6 — Schema corrections *(MED/LOW)*

- **`teams.is_public` default → `false`** (matches `handle_new_user`'s `is_public=false`; private-until-onboarding is the secure story). Update 01 §4.1 rationale accordingly.
- **Indexes consolidated in 01 §5 (sole owner):** public-feed partial index becomes `posts_public_feed_idx on posts(created_at desc, id desc) where is_public = true` (adds the `id desc` tiebreaker the keyset ordering needs); add partial `follows_approved_idx on follows(follower_team_id, following_team_id) where status='approved'` for `check_team_follows`. 05/07 **reference** these, never redefine.

### 6.7 — Input & test polish *(LOW)*

- **`completeOnboarding` privacy coercion (03 §8):** do **not** use `z.coerce.boolean()` (string `'false'` → `true`). Use presence/explicit semantics: `z.preprocess(v => v === 'on' || v === 'true', z.boolean())`.
- **Playwright smoke (09 B.5):** navigate to `/login` (route groups add no path segment), not `/auth/login`. Callback/confirm stay at `/auth/callback`, `/auth/confirm`.
- **README setup:** add an explicit step — "Disable *Confirm email* in Supabase Auth (or use the emailed confirm link)" — currently only listed as a limitation.

---

## 7. Product decisions (chosen defaults for the gaps the review flagged)

- **Logged-out affordance:** a slim public top-bar with the product name + **Sign in / Sign up** CTA; the feed shows public posts; the composer and team-only nav are hidden. (Satisfies "clear logged-in vs logged-out".)
- **Start-a-conversation entry point:** the **Teams browse page** (`/teams`) and each team card expose a **Message** button → `getOrCreateConversation(targetTeamId)` → redirect to `/messages/[conversationId]`. (Resolves the messaging discovery gap.)
- **Follow entry point:** same Teams browse page — **Follow** (public → instantly approved) or **Request** (private → pending), with state reflected on the button.

---

## 8. Build / migration order (from 01 §9 + 08 §2)

```
0001_extensions.sql      → pgcrypto, follow_status enum
0002_tables.sql          → teams, profiles, posts, follows, conversations, messages (+ posts.team_id default, is_public default false)
0003_indexes.sql         → consolidated index set (01 §5)
0004_helpers.sql         → current_user_team_id, check_team_follows, get_feed, get_inbox, get_incoming_follow_requests
0005_rls.sql             → enable RLS + all policies (incl. supabase_auth_admin read policies) + column GRANT(status)
0006_triggers.sql        → handle_new_user (auth.users), posts is_public sync (insert + team toggle)
0007_auth_hook.sql       → custom_access_token_hook + grants  (then enable it in Auth settings)
0008_seed.sql            → demo teams/users/posts (optional)
```

---

## 9. Feeds the AI Engineering Blueprint (09)

This review is itself a deliverable signal. `09 §A` should cite, as the concrete "how AI output was reviewed/validated" evidence:
- 6 bugs caught in the first-pass (Gemini) plan, and
- the 3-critic adversarial pass over the Claude-authored plan that surfaced **4 high / 8 med / 9 low** integration defects (claim-path mismatch, hook-under-RLS, missing column default, `get_feed` contract divergence, team-name visibility), all resolved here — demonstrating that AI-generated artifacts were treated as untrusted drafts and verified, not shipped blindly.
