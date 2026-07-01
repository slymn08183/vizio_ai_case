"use server";

import { createAnonClient } from "@/utils/supabase/anon";

/**
 * Count public posts created after `sinceIso` — backs the "new posts" pill.
 *
 * Uses the cookie-less anon client (not the session client): the pill only ever
 * compares against the PUBLIC slice's newest timestamp, and the public slice is
 * the same anon-readable data for every viewer. `head: true` ships zero rows —
 * just the exact count over the indexed `created_at` range — so this stays a
 * cheap COUNT(*) even when polled every ~15s by many clients.
 *
 * Fails CLOSED (returns 0) on any error so a transient blip never shows a
 * misleading nag pill.
 */
export async function countNewerPosts(sinceIso: string): Promise<number> {
  const supabase = createAnonClient();
  const { count, error } = await supabase
    .from("posts")
    .select("*", { count: "exact", head: true })
    .eq("is_public", true)
    .gt("created_at", sinceIso);
  if (error) return 0;
  return count ?? 0;
}
