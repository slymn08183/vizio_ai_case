"use client";

import { useActionState, useEffect, useRef } from "react";
import { createPost } from "@/actions/posts";
import { SubmitButton } from "@/components/submit-button";
import { textareaClasses } from "@/components/ui";
import { LIMITS } from "@/lib/constants";
import { EMPTY_ACTION_STATE } from "@/lib/types";

/**
 * Post composer for the acting team. No props — the action derives the team from
 * the verified JWT claim (DB default), so the composer never knows or sends a
 * team id. Clears the textarea once the action reports success.
 */
export function Composer() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(createPost, EMPTY_ACTION_STATE);

  // Clear the textarea after a successful post. We key off `state.success`
  // (the action returns a fresh object each run, but we reset only on success).
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <textarea
        name="content"
        required
        rows={3}
        maxLength={LIMITS.postContentMax}
        placeholder="Share something with your followers…"
        className={textareaClasses}
        aria-invalid={Boolean(state.errors?.content)}
      />

      {state.errors?.content?.length ? (
        <p className="text-xs text-danger" role="alert">
          {state.errors.content.join(", ")}
        </p>
      ) : state.message && !state.success ? (
        <p className="text-xs text-danger" role="alert">
          {state.message}
        </p>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Posting…">Post</SubmitButton>
      </div>
    </form>
  );
}
