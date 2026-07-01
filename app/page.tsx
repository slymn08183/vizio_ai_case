import { unstable_cache } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAnonClient } from "@/utils/supabase/anon";
import { getCurrentTeamId } from "@/lib/auth/claims";
import { TAGS, FEED_PAGE_SIZE } from "@/lib/constants";
import type { FeedItem } from "@/lib/types";
import { Composer } from "@/components/composer";
import { PostCard } from "@/components/post-card";
import { NewPostsPill } from "@/components/new-posts-pill";
import { EmptyState, LinkButton } from "@/components/ui";

/**
 * Home feed — one route serving BOTH audiences (logged-out and logged-in).
 *
 * Two disjoint slices, merged newest-first on the server:
 *  1. PUBLIC slice — every `is_public = true` post, identical for everyone
 *     (incl. anon). Fetched via the cookie-less anon client and wrapped in
 *     `unstable_cache` tagged `TAGS.publicFeed`, so it is computed once and
 *     reused across requests until `createPost` purges the tag.
 *  2. PRIVATE slice — per-viewer rows (own + approved-private-follow posts),
 *     served live by the `get_feed` SECURITY DEFINER RPC. Never cached.
 *
 * The route renders dynamically because `getUser()` reads cookies; that keeps
 * auth fresh and guarantees private data is never baked into a static page,
 * while the public slice still benefits from the tagged Data Cache.
 */

// Cached public-slice reader. The callback uses createAnonClient() (NOT the
// cookie-bound server client): unstable_cache callbacks may not read cookies,
// and the public slice carries no per-viewer data — it reads exactly what the
// anon role's RLS allows (is_public = true), so a single global cache key is
// both correct and the whole point.
const getPublicSlice = unstable_cache(
  async (): Promise<FeedItem[]> => {
    const anon = createAnonClient();
    const { data, error } = await anon
      .from("posts")
      .select("id, team_id, content, is_public, created_at, teams(name)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(FEED_PAGE_SIZE);
    if (error) throw error;
    // Flatten the embedded teams(name) into a flat team_name so both slices
    // share the FeedItem shape and PostCard renders them uniformly.
    return (data ?? []).map((row) => {
      const { teams, ...rest } = row as typeof row & {
        teams: { name: string } | null;
      };
      return { ...rest, team_name: teams?.name ?? "" } as FeedItem;
    });
  },
  ["public-feed"],
  { tags: [TAGS.publicFeed] },
);

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Onboarded is the same JWT claim the middleware/header read.
  const { data: claimsData } = await supabase.auth.getClaims();
  const onboarded =
    (claimsData?.claims as { app_metadata?: { onboarded?: boolean } } | undefined)
      ?.app_metadata?.onboarded === true;

  const teamId = onboarded ? await getCurrentTeamId() : null;

  // Public slice: cached + shared for everyone.
  const publicSlice = await getPublicSlice();

  // Private slice: only for authenticated + onboarded viewers.
  let privateSlice: FeedItem[] = [];
  if (teamId) {
    const { data, error } = await supabase.rpc("get_feed", {
      _viewer_team_id: teamId,
      _cursor: null,
      _limit: FEED_PAGE_SIZE,
    });
    if (error) throw error; // surfaced by app/error.tsx
    privateSlice = (data ?? []) as FeedItem[];
  }

  // Slices are disjoint by `is_public`, so merge needs no de-dup. Sort by
  // created_at desc, then id desc as the deterministic tiebreaker, then cap at
  // one page: each slice is fetched at FEED_PAGE_SIZE independently, so the
  // merged list is sliced to the global newest FEED_PAGE_SIZE (a clean "page 1").
  const posts = [...publicSlice, ...privateSlice]
    .sort((a, b) => {
      if (a.created_at !== b.created_at) {
        return a.created_at < b.created_at ? 1 : -1;
      }
      return a.id < b.id ? 1 : -1;
    })
    .slice(0, FEED_PAGE_SIZE);

  const newestCreatedAt = posts[0]?.created_at ?? null;
  const canPost = Boolean(user) && onboarded;

  return (
    <div className="flex flex-col gap-4">
      {canPost && <Composer />}

      {!user && (
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius)] border border-dashed border-border px-4 py-3 text-sm text-muted">
          <span>You are viewing public posts.</span>
          <LinkButton href="/login" variant="secondary" size="sm">
            Sign in
          </LinkButton>
        </div>
      )}

      <NewPostsPill newestCreatedAt={newestCreatedAt} />

      {posts.length === 0 ? (
        <EmptyState
          title="No posts yet"
          hint={
            canPost
              ? "Be the first to post — share something with your team and followers."
              : "Public posts will show up here as teams start sharing."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
