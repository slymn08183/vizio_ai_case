import { createClient } from "@/utils/supabase/server";
import { getCurrentTeamId } from "@/lib/auth/claims";
import { RequestActions } from "@/components/request-actions";
import { Avatar, Card, EmptyState } from "@/components/ui";
import { timeAgo } from "@/lib/utils";
import type { IncomingFollowRequest } from "@/lib/types";

export const metadata = { title: "Follow requests — TeamSocial" };

/**
 * Incoming follow-requests inbox (plan 05 §8.1).
 *
 * Server component. We do NOT embed `teams` to get the requester's name: the
 * strict teams SELECT RLS hides a PRIVATE requester's name from the target. The
 * SECURITY DEFINER RPC `get_incoming_follow_requests` surfaces the name in a
 * controlled, audited way (it self-guards on _viewer_team_id = current team),
 * so there is never an "Unknown team" fallback.
 */
export default async function RequestsPage() {
  const supabase = await createClient();
  const myTeamId = await getCurrentTeamId();

  if (!myTeamId) {
    return (
      <div className="mx-auto mt-8 max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold">Follow requests</h1>
        <div className="mt-3">
          <EmptyState
            title="No active team"
            hint="Sign in with a team to review follow requests."
          />
        </div>
      </div>
    );
  }

  const { data } = await supabase.rpc("get_incoming_follow_requests", {
    _viewer_team_id: myTeamId,
  });
  const requests = (data ?? []) as IncomingFollowRequest[];

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Follow requests</h1>
      <p className="mb-6 text-sm text-muted">
        Teams asking to follow your private team. Approve to grant access to your
        posts.
      </p>

      {requests.length === 0 ? (
        <EmptyState
          title="No pending requests"
          hint="When another team requests to follow you, it will show up here."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((req) => (
            <li key={req.follower_team_id}>
              <Card className="flex items-center gap-3 p-4">
                <Avatar name={req.follower_team_name} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">
                    {req.follower_team_name}
                  </span>
                  <span className="text-xs text-muted">
                    Requested {timeAgo(req.created_at)}
                  </span>
                </div>
                <div className="shrink-0">
                  <RequestActions followerTeamId={req.follower_team_id} />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
