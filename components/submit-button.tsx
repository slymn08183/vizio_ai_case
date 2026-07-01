"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui";
import type { ComponentProps } from "react";

/**
 * Submit button that auto-disables and shows a pending label while its enclosing
 * <form> action is in flight. Uses `useFormStatus`, so it MUST be rendered inside
 * a <form> (works with both Server Action forms and useActionState forms).
 */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}
