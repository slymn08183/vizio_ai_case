"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireCurrentTeamId } from "@/lib/auth/claims";
import type { ActionState } from "@/lib/types";

/**
 * Follow-system mutations (plan 05 / CONTRACTS §3.C).
 *
 * Authoritative resolution: CONTRACTS §3.C states there is NO DB status-forcing
 * trigger — the Server Action sets `status` and RLS `WITH CHECK` is the hard
 * guard. So `followTeam` reads the target's live `is_public` and chooses the
 * initial status; the client NEVER force-approves a follow to a private team
 * (RLS rejects an `approved` insert against a private target). This supersedes
 * plan 05's BEFORE INSERT trigger design.
 *
 * Revalidation: CONTRACTS §1 + §3.C pin these to `revalidatePath('/teams')`,
 * `revalidatePath('/requests')`, `revalidatePath('/')` (NOT `revalidateTag`,
 * which plan 05 used) — the contract wins.
 */

const teamIdSchema = z.string().uuid();

/** Bust every surface that reflects follow state. */
function revalidateFollowSurfaces() {
  revalidatePath("/teams");
  revalidatePath("/requests");
  revalidatePath("/");
}

export async function followTeam(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = teamIdSchema.safeParse(formData.get("teamId"));
  if (!parsed.success) return { success: false, message: "Invalid team id" };
  const targetTeamId = parsed.data;

  const supabase = await createClient();
  const myTeamId = await requireCurrentTeamId();

  // Self-follow guard (also enforced by the DB CHECK constraint + RLS with-check).
  if (myTeamId === targetTeamId) {
    return { success: false, message: "A team cannot follow itself." };
  }

  // Read the target's live privacy. The teams SELECT RLS returns the row only if
  // the target is public or is our own team, so a private/hidden target yields
  // no row → we treat it as a pending request (RLS still has the final say).
  const { data: target } = await supabase
    .from("teams")
    .select("is_public")
    .eq("id", targetTeamId)
    .maybeSingle();

  // Public target → instantly approved; otherwise a pending request. The client
  // never approves a private follow; the `follows_insert_as_follower` WITH CHECK
  // is the structural guard against self-approval into a private feed.
  const status = target?.is_public === true ? "approved" : "pending";

  const okMessage = status === "approved" ? "Following." : "Request sent.";

  const { error } = await supabase.from("follows").insert({
    follower_team_id: myTeamId,
    following_team_id: targetTeamId,
    status,
  });

  if (!error) {
    revalidateFollowSurfaces();
    return { success: true, message: okMessage };
  }

  // Anything other than a duplicate-edge conflict is a real failure.
  if (error.code !== "23505") {
    return { success: false, message: error.message };
  }

  // 23505 = the (follower, target) edge already exists. Inspect it (RLS lets a
  // follower read its own edge). An active pending/approved edge is a genuine
  // no-op; a 'rejected' tombstone must be re-openable, or the requester is
  // permanently locked out (and the UI would optimistically show a false
  // "Requested"). See the follow re-request review finding.
  const { data: existing } = await supabase
    .from("follows")
    .select("status")
    .eq("follower_team_id", myTeamId)
    .eq("following_team_id", targetTeamId)
    .maybeSingle();

  if (existing?.status !== "rejected") {
    return {
      success: true,
      message:
        existing?.status === "approved"
          ? "Already following."
          : "Request already sent.",
    };
  }

  // Re-request after a rejection. There is no follower-side UPDATE policy, so an
  // upsert would be blocked by RLS; the permitted path is delete-then-insert
  // (follows_delete_as_follower lets the follower remove its own edge).
  await supabase
    .from("follows")
    .delete()
    .eq("follower_team_id", myTeamId)
    .eq("following_team_id", targetTeamId);

  const { error: reErr } = await supabase.from("follows").insert({
    follower_team_id: myTeamId,
    following_team_id: targetTeamId,
    status,
  });
  if (reErr) return { success: false, message: reErr.message };

  revalidateFollowSurfaces();
  return { success: true, message: okMessage };
}

export async function unfollowTeam(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = teamIdSchema.safeParse(formData.get("teamId"));
  if (!parsed.success) return { success: false, message: "Invalid team id" };

  const supabase = await createClient();
  const myTeamId = await requireCurrentTeamId();

  // Remove our own outgoing edge. RLS (`follows_delete_as_follower`) also enforces
  // `follower_team_id = my team`, so this can only ever delete our own row.
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_team_id", myTeamId)
    .eq("following_team_id", parsed.data);

  if (error) return { success: false, message: error.message };

  revalidateFollowSurfaces();
  return { success: true, message: "Unfollowed." };
}

export async function approveFollowRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = teamIdSchema.safeParse(formData.get("followerTeamId"));
  if (!parsed.success) return { success: false, message: "Invalid team id" };

  const supabase = await createClient();
  const myTeamId = await requireCurrentTeamId();

  // I (the target) approve a request where I am the followee. RLS
  // (`follows_update_status_as_followee`) + column-level GRANT UPDATE(status)
  // ensure only the target can act and only `status` can change.
  const { data, error } = await supabase
    .from("follows")
    .update({ status: "approved" })
    .eq("follower_team_id", parsed.data)
    .eq("following_team_id", myTeamId)
    .select("follower_team_id"); // detect 0-row no-op (silent-RLS guard)

  if (error) return { success: false, message: error.message };
  // Under RLS, an UPDATE matching no permitted/existing row is success-with-0-rows,
  // not an error — without this check a forged/stale request would look approved.
  if (!data?.length) {
    return { success: false, message: "No pending request found." };
  }

  revalidateFollowSurfaces();
  return { success: true, message: "Request approved." };
}

export async function rejectFollowRequest(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = teamIdSchema.safeParse(formData.get("followerTeamId"));
  if (!parsed.success) return { success: false, message: "Invalid team id" };

  const supabase = await createClient();
  const myTeamId = await requireCurrentTeamId();

  // Reject is an UPDATE to a 'rejected' tombstone (not a DELETE), preserving an
  // auditable terminal state and blocking silent re-spam (plan 05 §7).
  const { data, error } = await supabase
    .from("follows")
    .update({ status: "rejected" })
    .eq("follower_team_id", parsed.data)
    .eq("following_team_id", myTeamId)
    .select("follower_team_id"); // detect 0-row no-op (silent-RLS guard)

  if (error) return { success: false, message: error.message };
  if (!data?.length) {
    return { success: false, message: "No pending request found." };
  }

  revalidateFollowSurfaces();
  return { success: true, message: "Request rejected." };
}
