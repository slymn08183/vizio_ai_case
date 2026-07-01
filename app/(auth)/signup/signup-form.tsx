"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { signUp } from "../actions";
import { Field, inputClasses } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { GoogleButton } from "@/components/google-button";
import { cn } from "@/lib/utils";
import { EMPTY_ACTION_STATE } from "@/lib/types";

type Mode = "create" | "join";

export function SignupForm() {
  const [state, action] = useActionState(signUp, EMPTY_ACTION_STATE);
  const [mode, setMode] = useState<Mode>("create");

  return (
    <div className="flex flex-col gap-5">
      {/* Create-vs-join toggle. The hidden `mode` input below tells the action
          which branch to validate. */}
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

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="mode" value={mode} />

        {mode === "create" ? (
          <Field
            label="Team name"
            htmlFor="teamName"
            error={state.errors?.teamName}
            hint="You can rename this during onboarding."
          >
            <input
              id="teamName"
              name="teamName"
              type="text"
              required
              placeholder="e.g. Acme Crew"
              className={inputClasses}
            />
          </Field>
        ) : (
          <Field
            label="Invite code"
            htmlFor="inviteCode"
            error={state.errors?.inviteCode}
            hint="Ask a teammate for your team's code (Settings → Invite)."
          >
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
        )}

        <Field label="Email" htmlFor="email" error={state.errors?.email}>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className={inputClasses}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={state.errors?.password}
          hint="At least 8 characters."
        >
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            className={inputClasses}
          />
        </Field>

        {state.message && !state.success && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}

        <SubmitButton pendingLabel="Creating account…">
          {mode === "create" ? "Create account" : "Join & create account"}
        </SubmitButton>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton />

      <p className="text-center text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
