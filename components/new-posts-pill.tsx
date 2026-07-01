"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { countNewerPosts } from "@/actions/feed";
import { cn } from "@/lib/utils";

const POLL_MS = 15_000; // ~15s — perceived freshness without a realtime socket.

/**
 * Floating "new posts available" pill. Polls `countNewerPosts(newestCreatedAt)`
 * roughly every 15s; when newer public posts exist, surfaces a pill that the
 * user clicks to pull them in via `router.refresh()` (re-runs the Server
 * Component, keeping scroll position — no client-side list reconciliation).
 *
 * The poller is disabled when `newestCreatedAt` is null (empty feed): there is
 * nothing to compare against, so there is nothing to poll for.
 */
export function NewPostsPill({
  newestCreatedAt,
}: {
  newestCreatedAt: string | null;
}) {
  const [count, setCount] = useState(0);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!newestCreatedAt) return; // empty feed → nothing to poll against
    // A new baseline (the feed was refreshed/re-rendered) makes any prior count
    // stale — clear it so we never show "N new posts" against fresher content.
    setCount(0);
    let alive = true;
    const tick = async () => {
      const n = await countNewerPosts(newestCreatedAt);
      if (alive) setCount(n);
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [newestCreatedAt]);

  if (count <= 0) return null;

  return (
    <div className="pointer-events-none sticky top-16 z-10 flex justify-center">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(() => {
            setCount(0);
            router.refresh();
          })
        }
        className={cn(
          "pointer-events-auto rounded-full border border-border bg-primary px-4 py-1.5 text-sm font-medium text-primary-fg shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50",
        )}
      >
        {isPending
          ? "Refreshing…"
          : `${count} new post${count === 1 ? "" : "s"} — click to refresh`}
      </button>
    </div>
  );
}
