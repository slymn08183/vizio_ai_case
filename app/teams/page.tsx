import { createClient } from "@/utils/supabase/server";
import { getCurrentTeamId } from "@/lib/auth/claims";
import { FollowButton } from "@/components/follow-button";
import { getOrCreateConversation } from "@/actions/messages";
import { SubmitButton } from "@/components/submit-button";
import { Avatar, Badge, Card, EmptyState } from "@/components/ui";
import type { TeamDirectoryItem } from "@/lib/types";

export const metadata = { title: "Teams — TeamSocial" };

/**
 * Teams browse — discovery surface for following and starting conversations
 * (00 §7). get_teams_directory() (DEFINER) lists every onboarded team by name,
 * including private ones — otherwise a private team could never be found to
 * send a follow request to. Content stays gated by the normal RLS on posts /
 * follows; this RPC only ever returns id/name/is_public, nothing sensitive.
 */
export default async function TeamsPage() {
  const supabase = await createClient();
  const myTeam = await getCurrentTeamId();

  const { data: teamsData, error } = await supabase.rpc("get_teams_directory");
  if (error) console.error("get_teams_directory failed:", error);
  const teams = (teamsData ?? []) as TeamDirectoryItem[];

  // My outgoing follow edges → status per target team. RLS limits this to rows
  // where I am the follower, so the eq() is a clarity/index hint, not the guard.
  const followMap = new Map<string, string>();
  // Teams that follow ME back (approved only) → the "Follows you" badge.
  // follows_select_participant already lets me read rows where I'm the
  // following_team_id, same RLS as the outgoing query above, just the other side.
  const followerSet = new Set<string>();
  let followingCount = 0;
  let followersCount = 0;
  if (myTeam) {
    const [{ data: outgoing }, { data: incoming }] = await Promise.all([
      supabase
        .from("follows")
        .select("following_team_id,status")
        .eq("follower_team_id", myTeam),
      supabase
        .from("follows")
        .select("follower_team_id")
        .eq("following_team_id", myTeam)
        .eq("status", "approved"),
    ]);
    for (const f of outgoing ?? []) {
      followMap.set(f.following_team_id as string, f.status as string);
      if (f.status === "approved") followingCount++;
    }
    for (const f of incoming ?? []) {
      followerSet.add(f.follower_team_id as string);
    }
    followersCount = followerSet.size;
  }

  // Map a raw follow status to the three-state the FollowButton understands.
  // 'rejected' (and anything else) collapses to 'none' so the user can re-request.
  const toInitialStatus = (
    raw: string | undefined,
  ): "none" | "pending" | "approved" =>
    raw === "approved" ? "approved" : raw === "pending" ? "pending" : "none";

  const others = teams.filter((t) => t.id !== myTeam);

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <h1 className="mb-1 text-xl font-semibold">Teams</h1>
      <p className="mb-2 text-sm text-muted">
        Follow teams to see their posts, or start a conversation.
      </p>
      {myTeam && (
        <p className="mb-6 text-sm">
          <span className="font-medium">{followingCount}</span>{" "}
          <span className="text-muted">following</span>
          <span className="mx-2 text-muted">·</span>
          <span className="font-medium">{followersCount}</span>{" "}
          <span className="text-muted">followers</span>
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {teams.map((team) => {
          const isMine = team.id === myTeam;
          return (
            <li key={team.id}>
              <Card className="flex items-center gap-3 p-4">
                <Avatar name={team.name} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{team.name}</span>
                    {team.is_public ? (
                      <Badge tone="public">Public</Badge>
                    ) : (
                      <Badge tone="private">Private</Badge>
                    )}
                    {isMine && <Badge tone="neutral">Your team</Badge>}
                    {!isMine && followerSet.has(team.id) && (
                      <Badge tone="pending">Follows you</Badge>
                    )}
                  </div>
                </div>

                {!isMine && (
                  <div className="flex shrink-0 items-center gap-2">
                    <FollowButton
                      teamId={team.id}
                      isPublic={team.is_public}
                      initialStatus={toInitialStatus(followMap.get(team.id))}
                    />
                    {/* Navigation-only action → redirects to the conversation
                        thread; reads `teamId` from this hidden input (CONTRACTS §3.D). */}
                    <form action={getOrCreateConversation}>
                      <input type="hidden" name="teamId" value={team.id} />
                      <SubmitButton variant="secondary" size="sm">
                        Message
                      </SubmitButton>
                    </form>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>

      {others.length === 0 && (
        <div className="mt-3">
          <EmptyState
            title="No other teams yet"
            hint="Public teams will appear here as they join. Check back soon to follow them or start a conversation."
          />
        </div>
      )}
    </div>
  );
}
