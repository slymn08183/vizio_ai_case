"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { LIMITS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

/**
 * Recovery actions for a TEAMLESS authenticated user (someone who was removed
 * from their team — their profile row is gone, so their next token carries no
 * team_id claim and middleware routes them here).
 *
 * IMPORTANT: these must NOT call requireCurrentTeamId() — the caller is teamless
 * by definition. The RPCs (0011) upsert the caller's OWN profile row (keyed off
 * auth.uid()), re-establishing a team. Both refreshSession() afterwards so the
 * new team_id + onboarded claims are minted before redirecting.
 */

const CreateTeam = z.object({
  teamName: z.string().min(LIMITS.teamNameMin).max(LIMITS.teamNameMax),
});
const JoinTeam = z.object({
  inviteCode: z.string().trim().min(1, "Enter an invite code"),
});

export async function createTeamAfterRemoval(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = CreateTeam.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_solo_team", {
    _name: parsed.data.teamName,
  });
  if (error) return { success: false, message: "Could not create your team." };

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return {
      success: false,
      message: "Created, but we couldn't refresh your session. Please reload.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/"); // new team is un-onboarded → middleware sends to /onboarding
}

export async function joinTeamAfterRemoval(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = JoinTeam.safeParse(Object.fromEntries(formData));
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
  if (error) return { success: false, message: "Could not join that team." };

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return {
      success: false,
      message: "Joined, but we couldn't refresh your session. Please reload.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/"); // joined team is already onboarded → straight to the feed
}
