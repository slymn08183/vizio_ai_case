"use client";

import { useActionState, useEffect, useState } from "react";
import { followTeam, unfollowTeam } from "@/actions/follows";
import { Button } from "@/components/ui";
import { EMPTY_ACTION_STATE } from "@/lib/types";

/**
 * Follow control for a target team (imported by the Teams page, domain E).
 *
 * Derives its label/action from the single (me → target) follow row's status
 * plus the target's privacy (plan 05 §8.3):
 *   - 'none'     → "Follow" (public) / "Request to follow" (private) via followTeam
 *   - 'pending'  → disabled "Requested"
 *   - 'approved' → "Following", revealing "Unfollow" on hover via unfollowTeam
 *
 * Optimism: we mirror the resolved status in local state so the button updates
 * immediately after a successful action without waiting for the server-rendered
 * page to refresh. The server revalidation (revalidatePath in the action) keeps
 * the next render authoritative.
 */
type Status = "none" | "pending" | "approved";

export function FollowButton({
  teamId,
  isPublic,
  initialStatus,
}: {
  teamId: string;
  isPublic: boolean;
  initialStatus: "none" | "pending" | "approved";
}) {
  const [status, setStatus] = useState<Status>(initialStatus);

  const [followState, follow, following] = useActionState(
    followTeam,
    EMPTY_ACTION_STATE,
  );
  const [unfollowState, unfollow, unfollowing] = useActionState(
    unfollowTeam,
    EMPTY_ACTION_STATE,
  );

  // Reflect the new edge state once an action succeeds. A public follow becomes
  // 'approved' immediately; a private follow becomes 'pending'.
  useEffect(() => {
    if (followState.success) setStatus(isPublic ? "approved" : "pending");
  }, [followState, isPublic]);

  useEffect(() => {
    if (unfollowState.success) setStatus("none");
  }, [unfollowState]);

  // Keep state in sync if the server re-renders us with a different prop value
  // (e.g. another member approved/changed the edge between renders).
  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  if (status === "pending") {
    return (
      <Button variant="secondary" size="sm" disabled aria-disabled>
        Requested
      </Button>
    );
  }

  if (status === "approved") {
    // "Following" by default; reveal "Unfollow" on hover/focus. The `group`
    // class lets the two labels swap purely via Tailwind state variants.
    return (
      <form action={unfollow}>
        <input type="hidden" name="teamId" value={teamId} />
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={unfollowing}
          aria-busy={unfollowing}
          className="group min-w-[6rem]"
        >
          <span className="group-hover:hidden group-focus:hidden">
            Following
          </span>
          <span className="hidden text-danger group-hover:inline group-focus:inline">
            Unfollow
          </span>
        </Button>
      </form>
    );
  }

  // status === "none"
  return (
    <form action={follow}>
      <input type="hidden" name="teamId" value={teamId} />
      <Button
        type="submit"
        variant="primary"
        size="sm"
        disabled={following}
        aria-busy={following}
      >
        {following
          ? "Working…"
          : isPublic
            ? "Follow"
            : "Request to follow"}
      </Button>
    </form>
  );
}
