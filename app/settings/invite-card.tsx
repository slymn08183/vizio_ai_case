"use client";

import { useActionState, useState } from "react";
import { regenerateInviteCode } from "./actions";
import { Button } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { EMPTY_ACTION_STATE } from "@/lib/types";

/**
 * Shows the team's invite code so members can invite others (share the code →
 * the invitee enters it on signup). Copy to clipboard + Regenerate (rotates the
 * code; the old one dies instantly). The code is only ever readable by fellow
 * members (team_invites RLS), and this card is only reachable post-onboarding.
 */
export function InviteCard({ code }: { code: string | null }) {
  const [state, action] = useActionState(
    regenerateInviteCode,
    EMPTY_ACTION_STATE,
  );
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select the code manually */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">Invite teammates</p>
        <p className="text-xs text-muted">
          Share this code. Anyone who enters it when signing up joins your team.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-[var(--radius)] border border-border bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider">
          {code ?? "—"}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={copy}
          disabled={!code}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <form action={action}>
          <SubmitButton variant="ghost" size="sm" pendingLabel="Regenerating…">
            Regenerate code
          </SubmitButton>
        </form>
        {state.message && (
          <span
            className={
              state.success ? "text-xs text-success" : "text-xs text-danger"
            }
            role={state.success ? "status" : "alert"}
          >
            {state.message}
          </span>
        )}
      </div>
    </div>
  );
}
