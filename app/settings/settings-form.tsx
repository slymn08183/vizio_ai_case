"use client";

import { useActionState } from "react";
import { updateTeamSettings } from "./actions";
import { Field, inputClasses } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { EMPTY_ACTION_STATE } from "@/lib/types";

export function SettingsForm({
  defaultName,
  defaultIsPublic,
}: {
  defaultName: string;
  defaultIsPublic: boolean;
}) {
  const [state, action] = useActionState(updateTeamSettings, EMPTY_ACTION_STATE);

  return (
    <form action={action} className="flex flex-col gap-5">
      <Field label="Team name" htmlFor="teamName" error={state.errors?.teamName}>
        <input
          id="teamName"
          name="teamName"
          type="text"
          required
          defaultValue={defaultName}
          placeholder="Your team's name"
          className={inputClasses}
        />
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border border-border bg-surface-2 p-3">
        <input
          type="checkbox"
          name="isPublic"
          value="on"
          defaultChecked={defaultIsPublic}
          className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
        />
        <span className="text-sm">
          <span className="font-medium">Make this team public</span>
          <span className="block text-muted">
            Public teams and their posts are visible to everyone (including
            logged-out visitors), and anyone can follow instantly. Private
            teams stay hidden and approve follow requests manually.
          </span>
        </span>
      </label>

      {state.message && (
        <p
          role={state.success ? "status" : "alert"}
          className={state.success ? "text-sm text-success" : "text-sm text-danger"}
        >
          {state.message}
        </p>
      )}

      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
