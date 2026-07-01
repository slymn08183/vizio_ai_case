import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn, initials } from "@/lib/utils";

// ── Button styling ───────────────────────────────────────────────────────────
// A single source of button classes so <button>, <Link>, and submit buttons all
// look identical. Domain components import `buttonClasses` or `<Button>`.

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-fg hover:opacity-90 disabled:opacity-50",
  secondary:
    "bg-surface-2 text-fg border border-border hover:bg-surface disabled:opacity-50",
  ghost: "text-muted hover:text-fg hover:bg-surface-2 disabled:opacity-50",
  danger:
    "bg-transparent text-danger border border-border hover:bg-surface-2 disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium transition-colors disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return (
    <button className={cn(buttonClasses(variant, size), className)} {...props} />
  );
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return (
    <Link className={cn(buttonClasses(variant, size), className)} {...props} />
  );
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-border bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "public" | "private" | "pending" | "success";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-2 text-muted",
    public: "bg-success/15 text-success",
    private: "bg-surface-2 text-muted",
    pending: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-primary/20 font-semibold text-primary"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[var(--radius)] border border-dashed border-border px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {children}
    </div>
  );
}

// ── Form field ───────────────────────────────────────────────────────────────

export function Field({
  label,
  htmlFor,
  error,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  error?: string[];
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error?.length && <p className="text-xs text-muted">{hint}</p>}
      {error?.length ? (
        <p className="text-xs text-danger" role="alert">
          {error.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

export const inputClasses =
  "h-10 w-full rounded-[var(--radius)] border border-border bg-surface-2 px-3 text-sm outline-none placeholder:text-muted focus:border-primary";

export const textareaClasses =
  "w-full resize-none rounded-[var(--radius)] border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-primary";
