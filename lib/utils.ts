/** Tiny classnames joiner (avoids pulling in clsx for a 3-day MVP). */
export function cn(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

/** Relative "time ago" for timestamps (newest-first feeds/inbox). */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  const units: Array<[number, string]> = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Number.POSITIVE_INFINITY, "y"],
  ];
  let value = secs;
  let unit = "s";
  for (const [step, label] of units) {
    if (value < step) {
      unit = label;
      break;
    }
    value = Math.floor(value / step);
    unit = label;
  }
  return `${value}${unit} ago`;
}

/** First two initials of a team name, for avatar badges. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * Deterministic hue (0–359) from a team name — the app's visual signature. Every
 * team carries its own colour on its monogram crest across the feed, teams list,
 * inbox and threads, so the tenant model ("you act as a team") is legible at a
 * glance. Same name → same colour, everywhere, with no stored state.
 */
export function teamHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return h;
}

/** The team's crest colours (tinted disc + bright monogram + hairline), derived
 *  from its hue. Tuned for the dark shell. */
export function teamCrest(name: string) {
  const h = teamHue(name);
  return {
    bg: `hsl(${h} 45% 20%)`,
    fg: `hsl(${h} 82% 74%)`,
    ring: `hsl(${h} 40% 32%)`,
    dot: `hsl(${h} 75% 62%)`,
  };
}
