"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { LIMITS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

const Onboarding = z.object({
  teamName: z.string().min(LIMITS.teamNameMin).max(LIMITS.teamNameMax),
  // Presence-check, NOT z.coerce.boolean(): coerce('false') === true (any
  // non-empty string is truthy), so an unchecked toggle posting 'false' would go
  // Public. Treat only 'on'/'true' as Public.
  isPublic: z.preprocess((v) => v === "on" || v === "true", z.boolean()),
});

export async function completeOnboarding(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = Onboarding.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not authenticated" };

  const { data: claimsData } = await supabase.auth.getClaims();
  const teamId = (
    claimsData?.claims as { app_metadata?: { team_id?: string } } | undefined
  )?.app_metadata?.team_id;
  if (!teamId) return { success: false, message: "No team on session" };

  // Idempotent UPDATE (the row already exists from the signup trigger). The teams
  // UPDATE RLS policy double-scopes the write to current_user_team_id().
  const { error } = await supabase
    .from("teams")
    .update({
      name: parsed.data.teamName,
      is_public: parsed.data.isPublic,
      onboarded: true,
    })
    .eq("id", teamId);
  if (error) return { success: false, message: error.message };

  // CRITICAL: mint a NEW token so the Auth Hook re-reads teams.onboarded = true.
  // Without this the cached token still says onboarded=false → /onboarding loop.
  // If the re-mint fails we must NOT redirect to "/" (middleware would bounce the
  // stale token straight back here): surface a retry instead. The teams UPDATE
  // above is idempotent, so retrying is safe.
  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) {
    return {
      success: false,
      message: "Saved, but we couldn't refresh your session. Please try again.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}
