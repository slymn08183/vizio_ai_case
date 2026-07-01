"use client";

import { useActionState } from "react";
import {
  approveFollowRequest,
  rejectFollowRequest,
} from "@/actions/follows";
import { SubmitButton } from "@/components/submit-button";
import { EMPTY_ACTION_STATE } from "@/lib/types";

/**
 * Approve / Reject controls for one incoming follow request (plan 05 §8.2).
 *
 * Two separate <form>s so each SubmitButton's `useFormStatus` reflects only its
 * own action's pending state. `useActionState` wraps each action in an implicit
 * startTransition, so the pending UI never blocks the main thread.
 */
export function RequestActions({
  followerTeamId,
}: {
  followerTeamId: string;
}) {
  const [approveState, approve] = useActionState(
    approveFollowRequest,
    EMPTY_ACTION_STATE,
  );
  const [rejectState, reject] = useActionState(
    rejectFollowRequest,
    EMPTY_ACTION_STATE,
  );

  const message =
    (!approveState.success && approveState.message) ||
    (!rejectState.success && rejectState.message) ||
    "";

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <form action={approve}>
          <input type="hidden" name="followerTeamId" value={followerTeamId} />
          <SubmitButton variant="primary" size="sm" pendingLabel="Approving…">
            Approve
          </SubmitButton>
        </form>
        <form action={reject}>
          <input type="hidden" name="followerTeamId" value={followerTeamId} />
          <SubmitButton variant="danger" size="sm" pendingLabel="Rejecting…">
            Reject
          </SubmitButton>
        </form>
      </div>
      {message ? (
        <p className="text-xs text-danger" role="alert" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
