"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { LIMITS, TAGS } from "@/lib/constants";
import { EMPTY_ACTION_STATE, type ActionState } from "@/lib/types";

/**
 * Validation boundary for an untrusted FormData submission. We validate ONLY
 * `content`: `team_id` is filled by the DB column default `current_user_team_id()`
 * and `is_public` by the `posts_set_is_public_before_insert` trigger, so the
 * client can never spoof either (CONTRACTS §1, plan 04 §4.2/§4.3).
 */
const CreatePostSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Your post is empty.")
    .max(
      LIMITS.postContentMax,
      `Posts are limited to ${LIMITS.postContentMax} characters.`,
    ),
});

export async function createPost(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // 1) Validate the untrusted input at the action boundary.
  const parsed = CreatePostSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  // 2) Server client factory is async (cookies() is async in Next 15) — await it.
  const supabase = await createClient();

  // 3) Auth gate for a friendly message. RLS is the real boundary regardless.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, message: "Please sign in to post." };
  }

  // 4) Insert ONLY content. team_id comes from the column DEFAULT
  //    current_user_team_id() (verified JWT claim) and is re-checked by the
  //    RLS WITH CHECK; is_public is set by the BEFORE INSERT trigger from the
  //    owning team. Never set either here.
  const { error } = await supabase
    .from("posts")
    .insert({ content: parsed.data.content });

  if (error) {
    // RLS denial surfaces as 42501. Log server-side, stay generic to the client
    // so we never leak schema/policy detail.
    console.error("[createPost] insert failed", {
      code: error.code,
      message: error.message,
    });
    return {
      success: false,
      message: "Could not publish your post. Please try again.",
    };
  }

  // 5) Invalidate exactly what changed: the shared cached public slice (07) and
  //    the home route. The per-viewer private slice is dynamic (no tag needed).
  revalidateTag(TAGS.publicFeed);
  revalidatePath("/");

  return { ...EMPTY_ACTION_STATE, success: true, message: "Posted" };
}
