import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getCurrentTeamId } from "@/lib/auth/claims";
import { Avatar, Card, EmptyState } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";
import type { InboxItem } from "@/lib/types";

export const metadata = { title: "Messages — TeamSocial" };

export default async function MessagesPage() {
  const supabase = await createClient();
  const teamId = await getCurrentTeamId();

  // get_inbox is SECURITY DEFINER and guards _viewer_team_id = current team, so
  // it surfaces a PRIVATE counterpart's name (which teams-SELECT RLS hides) only
  // for the caller's own conversations. Rows come back newest-activity-first.
  const { data, error } = teamId
    ? await supabase.rpc("get_inbox", { _viewer_team_id: teamId })
    : { data: null, error: null };
  if (error) console.error("get_inbox failed:", error);
  const conversations = (data as InboxItem[] | null) ?? [];

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold">Messages</h1>

      {conversations.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          hint="Start a conversation from the Teams page."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {conversations.map((c) => (
            <li key={c.conversation_id}>
              <Link
                href={`/messages/${c.conversation_id}`}
                className="block transition-colors"
              >
                <Card className="flex items-center gap-3 p-4 hover:bg-surface-2">
                  <Avatar name={c.other_team_name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "flex min-w-0 items-center gap-2 truncate",
                          c.unread ? "font-semibold" : "font-medium",
                        )}
                      >
                        {c.unread && (
                          <span
                            aria-label="Unread"
                            className="h-2 w-2 shrink-0 rounded-full bg-primary"
                          />
                        )}
                        <span className="truncate">{c.other_team_name}</span>
                      </span>
                      {c.last_message_at && (
                        <span className="shrink-0 text-xs text-muted">
                          {timeAgo(c.last_message_at)}
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        "truncate text-sm",
                        c.unread ? "text-fg" : "text-muted",
                      )}
                    >
                      {c.last_message ?? "No messages yet"}
                    </p>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
