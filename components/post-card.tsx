import { Avatar, Badge, Card } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import type { FeedItem } from "@/lib/types";

/**
 * Atomic feed unit. Purely presentational and server-renderable (no hooks), so
 * the Feed domain (07) can map `FeedItem[]` straight onto it. Prop shape is
 * fixed by CONTRACTS §3.A — do not change it.
 *
 * Content is interpolated as a React string child (auto-escaped) with
 * `whitespace-pre-wrap` for line breaks → no dangerouslySetInnerHTML, no
 * stored-XSS surface.
 */
export function PostCard({ post }: { post: FeedItem }) {
  return (
    <Card className="p-4 transition-colors hover:border-muted/30">
      <header className="flex items-center gap-3">
        <Avatar name={post.team_name} size={38} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{post.team_name}</div>
          <div className="font-mono text-[11px] text-muted">
            {timeAgo(post.created_at)}
          </div>
        </div>
        <span className="ml-auto shrink-0">
          {post.is_public ? (
            <Badge tone="public">Public</Badge>
          ) : (
            <Badge tone="private">Private</Badge>
          )}
        </span>
      </header>

      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-fg/95">
        {post.content}
      </p>
    </Card>
  );
}
