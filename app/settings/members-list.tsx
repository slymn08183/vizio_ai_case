"use client";

import { useActionState } from "react";
import { removeTeamMember, leaveTeam, switchTeam } from "./actions";
import { Avatar, Field, inputClasses } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { cn } from "@/lib/utils";
import { EMPTY_ACTION_STATE, type TeamMember } from "@/lib/types";

/**
 * Team members (surfaces the profiles_select_own_team policy — only teammates
 * see this list). No roles: any member may remove any other member, or leave.
 * Content stays team-identity; email is the only per-person field, shown only
 * to fellow members.
 */
export function MembersList({
  members,
  currentUserId,
}: {
  members: TeamMember[];
  currentUserId: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">
          Members{" "}
          <span className="font-normal text-muted">({members.length})</span>
        </p>
        <p className="text-xs text-muted">
          Everyone here posts and messages under the same team identity.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-[var(--radius)] border border-border">
        {members.map((m) => {
          const isSelf = m.id === currentUserId;
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar name={m.email} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm">{m.email}</span>
              {isSelf ? (
                <span className="shrink-0 text-xs text-muted">you</span>
              ) : (
                <RemoveMemberButton userId={m.id} email={m.email} />
              )}
            </li>
          );
        })}
      </ul>

      <TeamExitSection />
    </div>
  );
}

function RemoveMemberButton({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const [state, action] = useActionState(removeTeamMember, EMPTY_ACTION_STATE);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Remove ${email} from the team?`)) e.preventDefault();
      }}
      className="shrink-0"
    >
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton variant="danger" size="sm" pendingLabel="Removing…">
        Remove
      </SubmitButton>
      {state.message && !state.success && (
        <span className="sr-only" role="alert">
          {state.message}
        </span>
      )}
    </form>
  );
}

/**
 * Two ways to leave the current team: switch to an EXISTING team by invite code
 * (join_team_by_code moves your profile), or leave to a fresh solo team of your
 * own (leave_team). Both re-mint the session and redirect.
 */
function TeamExitSection() {
  const [switchState, switchAction] = useActionState(
    switchTeam,
    EMPTY_ACTION_STATE,
  );
  const [leaveState, leaveAction] = useActionState(leaveTeam, EMPTY_ACTION_STATE);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <p className="text-sm font-medium">Leave or switch team</p>

      {/* Switch to an existing team by code */}
      <form action={switchAction} className="flex flex-col gap-1.5">
        <Field
          label="Join another team"
          htmlFor="switchCode"
          error={switchState.errors?.inviteCode}
        >
          <div className="flex gap-2">
            <input
              id="switchCode"
              name="inviteCode"
              type="text"
              required
              autoCapitalize="characters"
              placeholder="Invite code"
              className={cn(inputClasses, "font-mono tracking-wide")}
            />
            <SubmitButton variant="secondary" pendingLabel="Switching…">
              Switch
            </SubmitButton>
          </div>
        </Field>
        {switchState.message && !switchState.success && (
          <p className="text-xs text-danger" role="alert">
            {switchState.message}
          </p>
        )}
      </form>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Leave to a fresh solo team */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">
          Leave and start a new team of your own.
        </span>
        <form
          action={leaveAction}
          onSubmit={(e) => {
            if (!confirm("Leave this team? You'll start a new team of your own."))
              e.preventDefault();
          }}
        >
          <SubmitButton variant="danger" size="sm" pendingLabel="Leaving…">
            Leave team
          </SubmitButton>
        </form>
      </div>
      {leaveState.message && !leaveState.success && (
        <p className="text-xs text-danger" role="alert">
          {leaveState.message}
        </p>
      )}
    </div>
  );
}
