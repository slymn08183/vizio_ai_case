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
    <Card className="p-4">
      <header className="flex items-center gap-3">
        <Avatar name={post.team_name} />
        <div className="flex flex-col">
          <span className="text-sm font-medium">{post.team_name}</span>
          <span className="text-xs text-muted">{timeAgo(post.created_at)}</span>
        </div>
        <span className="ml-auto">
          {post.is_public ? (
            <Badge tone="public">Public</Badge>
          ) : (
            <Badge tone="private">Private</Badge>
          )}
        </span>
      </header>

      <p className="mt-3 whitespace-pre-wrap text-sm">{post.content}</p>
    </Card>
  );
}
