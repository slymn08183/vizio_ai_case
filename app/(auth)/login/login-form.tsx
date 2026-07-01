"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signIn } from "../actions";
import { Field, inputClasses } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { GoogleButton } from "@/components/google-button";
import { EMPTY_ACTION_STATE } from "@/lib/types";

export function LoginForm() {
  const [state, action] = useActionState(signIn, EMPTY_ACTION_STATE);

  return (
    <div className="flex flex-col gap-5">
      <form action={action} className="flex flex-col gap-4">
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
        <Field label="Password" htmlFor="password" error={state.errors?.password}>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClasses}
          />
        </Field>

        {state.message && !state.success && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}

        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </form>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton />

      <p className="text-center text-sm text-muted">
        No account?{" "}
        <Link href="/signup" className="text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
