# AI Engineering Blueprint

> *How this project was actually built with AI — the tools, the rulesets, the
> prompting strategy, and (most importantly) how AI output was kept honest. The
> case weights "how & why > feature completeness" and flags the AI story as a
> strong positive signal; this document is the answer to "how did you use AI, and
> how did you keep it from shipping plausible-but-wrong code?"*

The one-line thesis: **every AI artifact was treated as an untrusted draft and
mechanically verified — against grounded research, a running toolchain, and
independent adversarial critics — before it counted.** The evidence is concrete:
two separate review passes caught **real** shipping-blockers, catalogued below.

---

## 1. Tool stack — who does what, and why

| Tool | Role | Why this tool |
|---|---|---|
| **Claude Code (Opus)** | Primary agentic driver. Owns the repo: writes migrations, RLS, Server Actions, components; runs `tsc`/`next build`/`next lint`; orchestrates multi-agent fan-out and the adversarial review. | A terminal-native agent that edits files *and* runs the toolchain in one loop, so generated SQL/TS is compiled and reviewed, not pasted blind. Re-reads a checked-in ruleset (`CLAUDE.md`) every turn. |
| **Gemini** | First-pass architecture sketch (ERD, DDL draft, RLS sketch, middleware, action skeletons). | Fast, long-context brainstorming for the *shape* of the system — cheap to iterate before committing engineering time. Treated as a proposal **to be audited**. |
| **NotebookLM** | Grounded field research: case PDF + curated Supabase/Next.js docs as sources, answering targeted questions on the decisions an LLM gets subtly wrong (RLS recursion, JWT claim freshness, anon NULL-comparison, keyset vs OFFSET, inbox ordering). | Answers are **citation-bound to uploaded sources**, sharply lowering hallucination risk on the risky decisions. |

**Why a multi-model split** rather than one model end-to-end: each model is used
where its failure mode is cheapest. Gemini diverges fast (good for breadth, weak
on correctness) → the throwaway first draft. NotebookLM is conservative and cited
(good for correctness, narrow) → grades the risky decisions. Claude Code closes
the loop by making the code compile and the tests/reviews pass.

---

## 2. Development workflow

```
1. Read the case PDF → extract hard requirements + constraints.
2. First-pass plan (Gemini)        → ERD, DDL, RLS sketch, action skeletons.
3. Grounded research (NotebookLM)  → cited answers on the risky decisions.
4. Adversarial review of the plan  → 6 real bugs found (§4) BEFORE any code.
5. Comprehensive multi-agent plan  → 9 domain files (docs/plan/01..09), one owner
                                      each, a shared naming contract up front.
6. 3-critic adversarial review of THAT plan → 4 high / 8 med / 9 low integration
                                      defects, all resolved canonically in 00.
7. Implementation (Claude Code):
   a. Author the security spine by hand (SQL migrations, Supabase clients,
      middleware, auth, onboarding) — the consistency-critical core.
   b. Parallel fan-out: 5 agents build the feature domains against a pinned
      CONTRACTS.md (disjoint files, shared interfaces fixed up front).
   c. Integrate → tsc + next build + next lint until green.
8. Second adversarial CODE review  → 4 dimension critics over the real code, each
                                      finding independently verified; 5 confirmed
                                      defects (§5), all fixed and re-verified.
```

Two stages are the value-add: **stage 4/6** (the plan is never trusted — it is
diffed against grounded research and independent critics) and **stage 8** (the
*code* gets the same untrusted-draft treatment the plan did).

**Why plan-then-implement, and why a naming contract:** the 3-day budget rewards
not redoing work. A pinned plan + a shared naming/interface contract
(`docs/plan/CONTRACTS.md`) means independently-generated sections converge instead
of drifting — the 5 parallel feature agents wrote disjoint files that compiled
together on the first integration pass with zero interface renames.

---

## 3. Agentic rulesets & memory (real artifacts in this repo)

| Artifact | Purpose |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | The operating ruleset re-read every turn: product invariants, locked decisions, hard coding rules (`await createClient()`, upsert-not-insert for conversations, column-only follow updates, `ActionState` shape, `revalidateTag`), the authoritative shared naming, and a "definition of done" + adversarial self-review checklist. Encodes the prior bugs so the agent can't regress them. |
| [`docs/plan/00-overview.md`](plan/00-overview.md) | Authoritative design: locked decisions, tech rationale, a 100% scope-coverage matrix, and the canonical reconciliation of every defect the plan reviews found (with corrected SQL/TS inline). |
| [`docs/plan/01..09`](plan) | The durable design, one owner per domain. The agent reads the relevant file before touching an area. |
| [`docs/plan/CONTRACTS.md`](plan/CONTRACTS.md) | The integration contract for parallel implementation — exact file ownership, exported signatures, import paths, the `TAGS`/`ActionState` conventions, RPC names. This is what let 5 agents build in parallel without drift. |

**Why a checked-in ruleset:** the locked decisions and the prior bugs are encoded
as rules the agent re-reads every turn — the cheapest possible guardrail. It stops
the model from "helpfully" reintroducing MakerKit-style abstractions, forgetting
`await createClient()`, or writing a bare `.insert()` for conversations.

---

## 4. Prompting & context strategy

1. **Constraint-first prompts.** Every task leads with the relevant invariant
   ("Tenant = Team, no profiles, RLS is the security boundary") so the model
   optimizes inside the real box. Generic "build a social feed" prompts were
   avoided — they produce user-centric schemas that violate the core model.
2. **Grounded > generative for risky decisions.** Anything with a correctness
   cliff was answered by NotebookLM against cited sources first, then handed to the
   coding agent as a settled decision.
3. **Shared naming/interface contract injected into context.** Identical
   identifiers across plan files and `CONTRACTS.md` → independently-generated
   sections compile together.
4. **Compile-and-review-in-the-loop.** The agent runs `tsc`/`next build`/`next
   lint` after edits and feeds failures straight back; then independent critic
   agents review the result. The toolchain and the critics — not the author —
   catch most mistakes.
5. **Adversarial self-review.** A standing instruction (the "Self-review pass"
   block in `CLAUDE.md`) forces re-reading the diff as an attacker: "what does the
   `anon` role see? what does Team B see? can a caller pass another team's id?"
   This is institutionalized as a multi-agent review workflow, not just a prompt.

---

## 5. How AI output was reviewed & validated — the concrete proof

Three independent review passes, each catching **real** defects. This is the
evidence that AI output here was *audited*, not trusted.

### 5.1 Pass one — review of the Gemini first-pass plan (6 bugs, pre-code)

| # | Bug | Why it breaks | Fix |
|---|---|---|---|
| 1 | `onboarded` written to `teams` but middleware read `app_metadata.onboarded` | Always `undefined` → infinite `/onboarding` redirect | Inject `onboarded` into the JWT via the Auth Hook; middleware reads the *same* claim |
| 2 | `getOrCreateConversation` used a bare `.insert()` | Throws `23505` on an existing conversation | `upsert(..., { onConflict, ignoreDuplicates: true })` then select |
| 3 | Claim injection via a trigger writing `raw_app_meta_data` | Races the token mint; first token can lack `team_id` | Custom Access Token Auth Hook reads team_id at mint time |
| 4 | Inbox not ordered by latest message | Fails "history newest-first" | `LEFT JOIN LATERAL max(created_at)` |
| 5 | `createClient()` not awaited (Next 15) | `cookies()` is async → auth silently null | `await createClient()` everywhere |
| 6 | `follows` UPDATE not column-restricted | Approver could rewrite the FK columns | `REVOKE UPDATE; GRANT UPDATE(status)` |

### 5.2 Pass two — 3-critic review of the *Claude-authored* plan (4 high / 8 med / 9 low)

The same untrusted-draft discipline applied to the comprehensive plan itself.
Three critics (coverage / consistency / correctness) surfaced, among others: a
**JWT claim-path mismatch**, the **Auth Hook reading 0 rows under RLS** (the
`supabase_auth_admin` role lacked a read policy), a **missing `posts.team_id`
default**, a **`get_feed` contract divergence**, and **private-team name
visibility**. All resolved canonically in [`00-overview.md` §6](plan/00-overview.md).

### 5.3 Pass three — adversarial review of the *built code* (5 confirmed defects)

A 4-dimension critic workflow (RLS/security, scope coverage, app correctness,
auth/session) reviewed the actual code; **each finding was then handed to an
independent verifier prompted to refute it**, so only confirmed defects survived.
Result: 5 confirmed, 0 false positives — all fixed and re-verified:

| Severity | Defect | Fix |
|---|---|---|
| **Security** | `check_team_follows()` (`SECURITY DEFINER`) kept the default `PUBLIC` execute grant with no caller guard → anyone, incl. anon, could probe the private follow graph via PostgREST RPC. | Added a caller guard (probing restricted to the caller's own team) + revoked the `PUBLIC`/anon execute grant. *(Notably, the verifier's first-suggested fix — revoke from `authenticated` — would have broken the `posts` RLS policy that calls the function as that role; the implemented fix accounts for that.)* |
| **Data/UX** | After a reject, the surviving `rejected` row made a re-request collide (`23505`), swallowed as a false "success" → permanent lockout. | RLS-permitted delete-then-insert of the rejected tombstone (an `upsert` would hit the absent follower-side UPDATE policy). |
| Low | Feed slices each capped at PAGE_SIZE then merged → up to 2×PAGE_SIZE, not the global newest N. | Slice merged result to `FEED_PAGE_SIZE`. |
| Low | "New posts" pill could show a stale count after a non-click refresh. | Reset the counter when the baseline changes. |
| Low | `completeOnboarding` ignored a `refreshSession()` error → possible bounce back to `/onboarding`. | Capture the error and surface a retry instead of redirecting on a stale token. |

### 5.4 A bug the *human* caught while transcribing

While hand-writing the migrations, a **dependency-ordering bug** in the plan
surfaced: `posts.team_id` defaults to `current_user_team_id()`, but the plan
created that function two migrations *after* the table — so `CREATE TABLE posts`
would fail on a clean `supabase db reset`. Fixed by defining the (table-free) JWT
resolver in `0001` before the tables. Documented inline in the migration.

> **Validation methods, ranked by what actually caught things:** (1) grounded
> research diff (plan bugs #1/#3/#6); (2) independent adversarial critics with a
> refute-step (the RPC leak + the re-request lockout); (3) `tsc`/`next build`
> (the integration/type layer — green before review); (4) requirement traceback
> (inbox ordering, scope gaps). The lesson encoded into the workflow: **AI breadth
> is excellent; AI correctness must be mechanically verified.**

---

## 6. Candidate vs. AI — decision split

| Decision / artifact | Driver |
|---|---|
| Core domain model (Tenant=Team, no profiles, public/private, follow-as-request) | **Candidate** — read from the case; the non-negotiable frame the AI works inside. |
| "Don't use MakerKit; build minimal" | **Candidate** — the starter's account/billing/role model fights one-user-one-team + no-over-abstraction. |
| First-pass ERD / DDL / RLS sketch | **AI (Gemini)** — speed draft, audited. |
| Risky-decision research | **AI (NotebookLM), candidate-framed** — candidate wrote the questions; NotebookLM answered against cited sources. |
| Catching the bugs (all three passes) | **Candidate-led, AI-assisted** — the decisive discipline. |
| Locked corrections (Auth Hook, upsert, await client, column-GRANT, lateral-join inbox, denormalized is_public) | **Candidate** — final architecture calls. |
| Implementation (migrations, RLS, actions, components, tests) | **AI (Claude Code), candidate-reviewed** — generated under `CLAUDE.md` constraints; every change gated by tsc/build/lint + adversarial review. |

> **One-line summary:** the candidate owns the model, the constraints, and the
> corrections; AI owns breadth, drafting, and mechanical execution; and **every AI
> artifact is gated by grounded research + a running toolchain + independent
> adversarial review before it counts.**

---

## 7. Why-notes index

- **Claude Code as primary driver** — closes generate → compile → review in one place.
- **Gemini for first-pass only** — fast breadth; an auditable proposal (that's how the 6 bugs surfaced).
- **NotebookLM for risky decisions** — citation-bound answers minimize hallucination where it's costly.
- **`CLAUDE.md` + `CONTRACTS.md` rulesets** — encode locked decisions + prior bugs + shared interfaces so parallel agents converge and can't regress.
- **Adversarial review with a refute-step** — independent verifiers kill plausible-but-wrong findings, so the surviving fixes are real (5/5 confirmed, 0 false positives).
