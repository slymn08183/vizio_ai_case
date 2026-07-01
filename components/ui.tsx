import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn, initials, teamCrest } from "@/lib/utils";

// ── Buttons ──────────────────────────────────────────────────────────────────
// One source of button styling. Primary is inverted (near-white) for a premium,
// non-neon feel; colour on this app belongs to the teams, not the chrome.

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-fg shadow-sm hover:bg-white",
  secondary:
    "bg-surface-2 text-fg border border-border hover:bg-surface hover:border-muted/40",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger:
    "bg-transparent text-danger border border-border hover:bg-danger/10 hover:border-danger/40",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md") {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium",
    "transition duration-150 active:scale-[0.98]",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 disabled:hover:bg-primary",
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
        "rounded-[var(--radius)] border border-border bg-surface shadow-card",
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
    neutral: "border-border bg-surface-2 text-muted",
    public: "border-success/25 bg-success/10 text-success",
    private: "border-border bg-surface-2 text-muted",
    pending: "border-accent/25 bg-accent/10 text-accent",
    success: "border-success/25 bg-success/10 text-success",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

/**
 * Team crest — a monogram tile in the team's own deterministic colour (see
 * teamHue). The rounded-square (not a circle) reads as a team logo/crest, and
 * the per-team hue is the app's visual signature: every team is recognisable by
 * colour across the feed, teams list, inbox and threads.
 */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const crest = teamCrest(name);
  return (
    <div
      className="flex shrink-0 select-none items-center justify-center font-semibold leading-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        borderRadius: Math.max(6, size * 0.28),
        background: crest.bg,
        color: crest.fg,
        boxShadow: `inset 0 0 0 1px ${crest.ring}`,
      }}
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
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-border bg-surface/40 px-6 py-14 text-center">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-[12px] border border-border bg-surface-2 text-muted"
        aria-hidden
      >
        <span className="eyebrow" style={{ letterSpacing: "0.05em" }}>
          ∅
        </span>
      </div>
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
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
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
  "h-10 w-full rounded-[var(--radius)] border border-border bg-surface-2 px-3 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/20";

export const textareaClasses =
  "w-full resize-none rounded-[var(--radius)] border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/20";
