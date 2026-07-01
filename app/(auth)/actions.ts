"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { LIMITS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

const Credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Signup has two modes: CREATE a brand-new team (default) or JOIN an existing
// team with an invite code. A discriminated union validates only the field the
// chosen mode needs. The DB's handle_new_user trigger (0011) does the actual
// create-or-join from raw_user_meta_data; an invalid code there falls back to
// CREATE rather than failing signup, so the pre-check below is UX-only.
const CreateSignup = Credentials.extend({
  mode: z.literal("create"),
  teamName: z.string().min(LIMITS.teamNameMin).max(LIMITS.teamNameMax),
});
const JoinSignup = Credentials.extend({
  mode: z.literal("join"),
  inviteCode: z.string().trim().min(1, "Enter an invite code"),
});
const SignUp = z.discriminatedUnion("mode", [CreateSignup, JoinSignup]);

export async function signUp(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SignUp.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();

  // Forwarded to auth.users.raw_user_meta_data → consumed by handle_new_user():
  // { team_name } → create a new team; { invite_code } → join that team.
  let options: { data: Record<string, string> };
  if (parsed.data.mode === "join") {
    // Pre-validate for a friendly error. invite_code_valid returns only a
    // boolean (never a team id/name), so it is safe to call as the anon role.
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
    options = { data: { invite_code: parsed.data.inviteCode } };
  } else {
    options = { data: { team_name: parsed.data.teamName } };
  }

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options,
  });
  if (error) return { success: false, message: error.message };

  // If email confirmation is ON, the session starts after /auth/confirm;
  // otherwise it is live now. Joiners land on an already-onboarded team, so
  // middleware sends them straight to the feed; creators go through onboarding.
  redirect("/onboarding");
}

export async function signIn(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = Credentials.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { success: false, message: "Invalid email or password" };

  revalidatePath("/", "layout");
  redirect("/"); // middleware routes to /onboarding if onboarded=false
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
