/**
 * Shared application types.
 *
 * Entity shapes mirror the DDL (plan 01 §11). In a longer-lived project these
 * would be generated via `supabase gen types typescript` (see package.json
 * `gen:types`); they are hand-declared here so the app type-checks before a live
 * schema exists, and kept deliberately in sync with the migrations.
 */

export type FollowStatus = "pending" | "approved" | "rejected";

export interface Team {
  id: string;
  name: string;
  is_public: boolean;
  onboarded: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  team_id: string;
  email: string;
  created_at: string;
}

export interface Post {
  id: string;
  team_id: string;
  content: string;
  is_public: boolean;
  created_at: string;
}

export interface Follow {
  follower_team_id: string;
  following_team_id: string;
  status: FollowStatus;
  created_at: string;
}

export interface Conversation {
  id: string;
  team_a_id: string;
  team_b_id: string;
  created_at: string;
  team_a_last_read_at: string | null;
  team_b_last_read_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_team_id: string;
  content: string;
  created_at: string;
}

// ── RPC return rows (must match the SECURITY DEFINER functions in 0004) ──────

/** One feed item. team_name is carried by both slices so PostCard renders the
 *  author even for private counterpart teams. */
export interface FeedItem {
  id: string;
  team_id: string;
  team_name: string;
  content: string;
  is_public: boolean;
  created_at: string;
}

/** One inbox row from get_inbox(). */
export interface InboxItem {
  conversation_id: string;
  other_team_id: string;
  other_team_name: string;
  last_message: string | null;
  last_message_at: string | null;
  unread: boolean;
}

/** One pending request from get_incoming_follow_requests(). */
export interface IncomingFollowRequest {
  follower_team_id: string;
  follower_team_name: string;
  created_at: string;
}

/** One row from get_teams_directory() — every onboarded team, name-only. */
export interface TeamDirectoryItem {
  id: string;
  name: string;
  is_public: boolean;
}

/** A teammate, shown in Settings → Members (only to fellow members, via
 *  profiles_select_own_team). Content stays team-identity; email is the only
 *  per-person field surfaced, and only inside the team. */
export interface TeamMember {
  id: string;
  email: string;
  created_at: string;
}

// ── Server Action result envelope ────────────────────────────────────────────

/** Standardized Server Action return, consumed by React 19 `useActionState`.
 *  Every action resolves to this shape (plan 08 §3 / 03 §7). */
export interface ActionState {
  success: boolean;
  message: string;
  errors?: Record<string, string[]>;
}

/** Initial state for `useActionState`. */
export const EMPTY_ACTION_STATE: ActionState = { success: false, message: "" };
