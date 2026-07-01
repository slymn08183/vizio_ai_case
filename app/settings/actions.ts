"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireCurrentTeamId } from "@/lib/auth/claims";
import { LIMITS, TAGS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

const Settings = z.object({
  teamName: z.string().min(LIMITS.teamNameMin).max(LIMITS.teamNameMax),
  // Same presence-check as onboarding: only 'on'/'true' means Public, an
  // unchecked box (which posts nothing) must resolve to false, not truthy-coerce.
  isPublic: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

/**
 * Post-onboarding team settings: rename + flip public/private. The onboarding
 * form only asks once; this is the "you can change this later" it promises.
 */
export async function updateTeamSettings(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = Settings.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const teamId = await requireCurrentTeamId();
  const supabase = await createClient();

  // teams_update_own RLS double-scopes this to current_user_team_id(); the
  // is_public-sync trigger (0006) propagates the flag onto every existing post.
  const { error } = await supabase
    .from("teams")
    .update({ name: parsed.data.teamName, is_public: parsed.data.isPublic })
    .eq("id", teamId);
  if (error) return { success: false, message: "Could not save settings." };

  // A visibility flip changes which posts belong in the cached public slice;
  // the name change should show up in the header / teams directory right away.
  revalidateTag(TAGS.publicFeed);
  revalidatePath("/", "layout");

  return { success: true, message: "Settings saved." };
}

// ── Team membership management (RPCs owned by migration 0011) ─────────────────

/**
 * Rotate the team's invite code. The RPC is parameterless — it can only ever
 * touch current_user_team_id() — so there is no team id for a caller to spoof.
 * The old code dies instantly. We revalidate so the Settings RSC re-reads and
 * shows the new code; the returned code itself doesn't need threading to the UI.
 */
export async function regenerateInviteCode(): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_invite_code");
  if (error) return { success: false, message: "Could not regenerate the code." };

  revalidatePath("/settings");
  return { success: true, message: "New invite code generated." };
}

const RemoveMember = z.object({ userId: z.string().uuid() });

/**
 * Remove a teammate. The RPC re-derives the target's team from the DB and
 * rejects (42501) anyone who isn't a same-team member, and forbids removing
 * yourself (use leaveTeam). The removed user's session keeps its stale team
 * claim until its next token refresh (≤ jwt_expiry), then lands on /no-team —
 * documented as a known limitation.
 */
export async function removeTeamMember(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = RemoveMember.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { success: false, message: "Invalid member." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_team_member", {
    _user_id: parsed.data.userId,
  });
  if (error) return { success: false, message: "You can't remove that member." };

  revalidatePath("/settings");
  return { success: true, message: "Member removed." };
}

/**
 * Leave the current team. The RPC re-provisions a fresh solo team and moves the
 * caller's own profile row to it, so a leaver is NEVER teamless. We must
 * refreshSession() to re-mint the JWT with the new team_id + onboarded=false;
 * without it the stale token loops back here. Mirrors completeOnboarding's
 * refresh-or-retry pattern. The new un-onboarded team routes them to /onboarding.
 */
export async function leaveTeam(): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_team", { _new_team_name: null });
  if (error) return { success: false, message: "Could not leave the team." };

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return {
      success: false,
      message: "Left the team, but couldn't refresh your session. Please reload.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

const SwitchTeam = z.object({
  inviteCode: z.string().trim().min(1, "Enter an invite code"),
});

/**
 * Switch to an EXISTING team by invite code — an alternative to leaveTeam's
 * "leave and start fresh". join_team_by_code (0011) upserts the caller's own
 * profile with `on conflict (id) do update set team_id`, so it re-points an
 * existing member to the new team in one step (no teamless in-between). The old
 * team is simply left behind (it may become empty — see README limitations).
 * refreshSession() re-mints the JWT with the new team_id before we redirect.
 */
export async function switchTeam(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SwitchTeam.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();

  const { data: valid } = await supabase.rpc("invite_code_valid", {
    _code: parsed.data.inviteCode,
  });
  if (!valid) {
    return {
      success: false,
      message: "That invite code is not valid.",
      errors: { inviteCode: ["Invalid invite code"] },
    };
  }

  const { error } = await supabase.rpc("join_team_by_code", {
    _code: parsed.data.inviteCode,
  });
  if (error) return { success: false, message: "Could not switch teams." };

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return {
      success: false,
      message: "Switched, but couldn't refresh your session. Please reload.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/"); // joined team is already onboarded → straight to its feed
}
