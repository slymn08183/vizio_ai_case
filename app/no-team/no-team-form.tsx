"use client";

import { useActionState, useState } from "react";
import { createTeamAfterRemoval, joinTeamAfterRemoval } from "./actions";
import { Field, inputClasses } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { cn } from "@/lib/utils";
import { EMPTY_ACTION_STATE } from "@/lib/types";

type Mode = "create" | "join";

export function NoTeamForm() {
  const [mode, setMode] = useState<Mode>("create");
  const [createState, createAction] = useActionState(
    createTeamAfterRemoval,
    EMPTY_ACTION_STATE,
  );
  const [joinState, joinAction] = useActionState(
    joinTeamAfterRemoval,
    EMPTY_ACTION_STATE,
  );
  const state = mode === "create" ? createState : joinState;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-1 rounded-[var(--radius)] border border-border bg-surface-2 p-1 text-sm">
        {(["create", "join"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-[calc(var(--radius)-2px)] px-3 py-1.5 font-medium transition-colors",
              mode === m
                ? "bg-primary text-primary-fg"
                : "text-muted hover:text-fg",
            )}
          >
            {m === "create" ? "Create a team" : "Join a team"}
          </button>
        ))}
      </div>

      {mode === "create" ? (
        <form action={createAction} className="flex flex-col gap-4">
          <Field label="Team name" htmlFor="teamName" error={createState.errors?.teamName}>
            <input
              id="teamName"
              name="teamName"
              type="text"
              required
              placeholder="Your team's name"
              className={inputClasses}
            />
          </Field>
          {state.message && !state.success && (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          )}
          <SubmitButton pendingLabel="Creating…">Create a new team</SubmitButton>
        </form>
      ) : (
        <form action={joinAction} className="flex flex-col gap-4">
          <Field label="Invite code" htmlFor="inviteCode" error={joinState.errors?.inviteCode}>
            <input
              id="inviteCode"
              name="inviteCode"
              type="text"
              required
              autoCapitalize="characters"
              placeholder="e.g. 3F9A2B1C7D0E4A65"
              className={cn(inputClasses, "font-mono tracking-wide")}
            />
          </Field>
          {state.message && !state.success && (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          )}
          <SubmitButton pendingLabel="Joining…">Join team</SubmitButton>
        </form>
      )}
    </div>
  );
}
