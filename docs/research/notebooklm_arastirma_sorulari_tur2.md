# NotebookLM Saha Araştırması — Tur 2 (Feed kararı sonrası açılan boşluklar)

> **Kullanım:** Aşağıdaki **Brief**'i ve **Soru Listesi**'ni NotebookLM'e yapıştır. Kaynak olarak şunları ekle:
> 1. Vizio AI Case Study PDF'i
> 2. Supabase Docs (Auth, RLS, Realtime, Postgres Functions, SSR)
> 3. Next.js App Router Docs (Caching/Revalidation, Server Actions, Route Handlers, Middleware)
>
> Bu tur, 1. turda **zaten cevaplanmış** konuları (RLS recursion / SECURITY DEFINER, app_metadata temeli, simetrik conversation constraint + ON CONFLICT, hybrid signup trigger) **tekrar sormaz**. Sadece feed kararı sonrası açılan boşlukları ve hâlâ görüş gereken yüksek-değerli noktaları hedefler.

---

## PROJECT BRIEF (locked decisions)

We are building a **team-based social media MVP** with **Next.js 15 (App Router)** and **Supabase**, from our **own minimal setup** (no MakerKit starter).

Locked architecture decisions:
- **Tenant = Team.** Each authenticated user belongs to exactly one team. No individual profiles; all actions (post, follow, message) happen under the team identity. Roles are out of scope.
- **Teams are Public or Private.** Public teams can be followed immediately; private teams require an approved follow request before their posts become visible to the follower.
- **Security is enforced at the database level via Supabase RLS.** Active `team_id` lives in the JWT `app_metadata` (never `user_metadata`), with a DB fallback in a `SECURITY DEFINER` helper.
- **Realtime is used ONLY for team-to-team messaging.** The global home feed uses **Next.js Server Action revalidation / refetch** (NOT realtime). A realtime feed is explicitly deferred as a stretch goal.
- The **home feed must be viewable without authentication** for public content, newest-first, and must show private-team posts only to approved followers.
- Target deploy: **Vercel**.

Goal: a clean, production-aware MVP in 3 days. We want best practices, common-pitfall avoidance, and clear trade-offs — grounded in the source docs.

---

## SORU LİSTESİ (Research Prompts)

### A) Feed — Caching & Revalidation (revalidation, NOT realtime)

**1. Feed cache strategy & private-data leakage.**
> "In the Next.js App Router, what is the recommended caching/revalidation strategy for a 'newest-first' social feed that mixes **anonymously cacheable public posts** with **per-team private posts** gated by RLS? Compare `revalidatePath` vs `revalidateTag` vs `unstable_cache` vs forcing dynamic rendering. Critically: how do we prevent **one team's private posts from leaking into another user's cached response** (shared Data Cache / Full Route Cache pitfalls), and how should cache keys account for the authenticated team?"

**2. Static public feed vs dynamic authenticated feed.**
> "The home feed must be publicly viewable without authentication for public content, but personalized (shows approved-private posts) when logged in. Is the cleanest pattern to render the **logged-out public feed as a statically cached / ISR route** and the **authenticated feed as a dynamic route**, or to serve both from one dynamic route? What are the trade-offs in correctness, performance, and cache invalidation when a new post is created (`revalidatePath` behavior for both audiences)?"

**3. Keyset pagination + revalidation interplay.**
> "For an ordered (created_at desc) feed using **keyset/cursor pagination**, how does it interact with `revalidatePath` after a new post is inserted? What is the recommended approach so newly created posts appear correctly without breaking cursor boundaries, and what is a good lightweight 'new posts available — refresh' UX pattern (e.g., a count query) that gives perceived liveness without realtime?"

### B) Feed — Query architecture & RLS performance

**4. RLS-on-table vs SECURITY DEFINER feed RPC.**
> "For a visibility-filtered feed query (a team's own posts + all public teams' posts + posts from private teams the viewer's team has an **approved** follow for), is it better to (a) rely on **row-by-row RLS** on the `posts` table, or (b) expose a **`SECURITY DEFINER` RPC like `get_feed(viewer_team_id, cursor)`** that resolves visibility once in SQL? Discuss the trade-off between defense-in-depth (RLS always on) and query performance, and whether we can keep RLS enabled while ALSO using an RPC for the hot feed path. Include indexing recommendations for this specific query."

**5. Anonymous (anon role) public feed via RLS.**
> "What is the correct, secure way to serve **public posts and public team metadata to unauthenticated (anon role) users** through Supabase RLS? Cover the required `GRANT`s, the policy shape (a single `is_public` clause vs a dedicated anon policy), and whether exposing a **public view or RPC** is preferable. How do we **guarantee zero leakage** of private-team data to the anon role, given our SELECT policy also references `current_user_team_id()` which is null for anon?"

### C) Auth, Session & Custom Claims

**6. Canonical custom-claim propagation (team_id, onboarded) into the JWT.**
> "In **Next.js 15 + @supabase/ssr**, what is the **canonical, race-free** way to get custom claims (`team_id`, `onboarded`) into a user's JWT so middleware and RLS read them reliably? Compare three approaches: (a) a **Custom Access Token Auth Hook**, (b) `supabase.auth.admin.updateUserById` + client `refreshSession()`, and (c) a trigger that writes `raw_app_meta_data` on `auth.users`. Which is recommended in 2025? Does `supabase.auth.getUser()` in middleware return **fresh** `app_metadata` (server-validated) or stale token claims? How do we avoid a **stale/missing claim immediately after signup** before the first refresh?"

**7. OAuth callback + provisioning race condition.**
> "With **Google OAuth (PKCE)** and an App Router `/auth/callback/route.ts` that does `exchangeCodeForSession`, what is the cleanest pattern so that our **DB trigger** (creates team + profile on `auth.users` insert) and the **callback logic** (sets claims / redirects to onboarding) do **not race**? How do we make provisioning **idempotent** and ensure the user always lands with a valid `team_id` claim, for both first-time OAuth signup and returning login?"

### D) Messaging

**8. Realtime mechanism for team-scoped chat: Postgres Changes vs Broadcast.**
> "For **team-to-team direct messaging** scoped per conversation, which Supabase Realtime mechanism is recommended in the current version: **Postgres Changes** (listen to inserts on `messages` filtered by `conversation_id`) or **Broadcast / Broadcast-from-Database**? Explain how **RLS / Realtime Authorization** applies to each, the per-channel topic conventions, and the trade-offs in setup complexity vs scalability for a small fan-out (2 teams per conversation)."

**9. Inbox ordering by latest message.**
> "To display a conversation/inbox list **ordered by newest message timestamp** in Postgres/Supabase, compare three approaches: a **denormalized `last_message_at`** column on `conversations` maintained by an `AFTER INSERT` trigger on `messages`, a **lateral join / correlated subquery** at read time, and a **view/materialized view**. Which is best for an MVP in terms of correctness, write-amplification, and read performance? Provide the trigger pattern if denormalization is recommended."

### E) Follow System & Architecture/Quality

**10. Follow modeling, constraints & mutation pattern.**
> "Two related questions: **(i) Data model** — for 'public teams followed immediately (approved)' vs 'private teams require a pending request that the target approves/rejects', is a **single `follows` table with a `status` enum** better than **separate `follows` + `follow_requests` tables**? Give the cleanest constraints and RLS (prevent self-follow, prevent duplicates, restrict the approve/reject UPDATE to only the **target** team and only the `status` column, handle unfollow and a retroactive public→private toggle). **(ii) Mutation pattern** — in the App Router, for mutations like create-post / follow / approve / send-message, are **Server Actions** or **Route Handlers** preferred in 2025, and what is the recommended error-handling + `revalidatePath` pattern? Also: what is the **highest-ROI way to prove RLS correctness in 3 days** (pgTAP, `supabase db test`, SQL assertions, or Playwright E2E for auth flows)?"

---

## Notlar (bizim için, NotebookLM'e gönderme)

- Soru 1-2-3 doğrudan senin "relative/revalidation feed" kararının teknik boşluklarını kapatıyor.
- Soru 4-5 feed'in performans + anonim erişim güvenliğini netleştiriyor (case'in "publicly viewable without auth" + "reasonable performance" maddeleri).
- Soru 6-7 Gemini planındaki en kırılgan yer olan claim/onboarding tazeliğini doğru pattern'e oturtuyor.
- Soru 8-9 mesajlaşmayı (kilitlediğimiz tek realtime alan) sağlamlaştırıyor.
- Soru 10 follow modeli + mutation pattern + test stratejisini tek seferde kapatıyor (AI-native "quality" sinyali için).

Cevaplar gelince: bu cevaplar + case scope + düzeltilmiş Gemini planı ışığında **multi-agent kapsamlı planlamayı** başlatacağım (her domain'e ayrı planlayıcı + adversarial review + sentez → md + mermaid çıktılar).
