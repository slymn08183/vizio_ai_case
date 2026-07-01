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
