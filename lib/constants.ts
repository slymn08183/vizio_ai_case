/**
 * Cache-tag registry — the SINGLE source of truth for `revalidateTag` strings
 * (plan 00 §6.5). Producers (RSC fetches that pass `{ next: { tags } }`) and
 * consumers (Server Actions that call `revalidateTag`) must use the SAME string,
 * so they are computed here and never hand-written as raw strings anywhere.
 */
export const TAGS = {
  /** The cached public-feed slice (revalidated when a public post is created). */
  publicFeed: "public_feed",
  /** A team's follow edges (revalidated on follow/approve/reject). */
  teamFollows: (teamId: string) => `team_follows:${teamId}`,
  /** A team's message inbox (revalidated when a message is sent). */
  teamInbox: (teamId: string) => `inbox:${teamId}`,
} as const;

/** Content length bounds — mirror the DB CHECK constraints (plan 01). */
export const LIMITS = {
  postContentMax: 2000,
  messageContentMax: 4000,
  teamNameMin: 2,
  teamNameMax: 50,
} as const;

/** Feed page size for keyset pagination (plan 07). */
export const FEED_PAGE_SIZE = 20;
