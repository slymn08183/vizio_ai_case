"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireCurrentTeamId } from "@/lib/auth/claims";
import { LIMITS } from "@/lib/constants";
import type { ActionState } from "@/lib/types";

/**
 * Start (or re-open) a conversation with another team, then navigate to it.
 *
 * Navigation-only action → `(formData) => Promise<void>` shape (CONTRACTS §1):
 * it redirects on success rather than returning an ActionState. Used by the
 * Teams page Message <form action={getOrCreateConversation}>.
 */
export async function getOrCreateConversation(
  formData: FormData,
): Promise<void> {
  const target = z.string().uuid().safeParse(formData.get("teamId"));
  // Bad/missing target id: bounce back to Teams rather than crashing.
  if (!target.success) redirect("/teams");

  const me = await requireCurrentTeamId();
  const targetTeamId = target.data;

  // A team cannot start a conversation with itself; the DB CHECK
  // (team_a_id < team_b_id) makes {A,A} impossible too — this is the UX guard.
  if (targetTeamId === me) redirect("/teams");

  const supabase = await createClient();

  // Canonical ordering: smaller uuid → team_a_id, satisfying the
  // `conversations_canonical_order` CHECK and the UNIQUE(team_a_id, team_b_id).
  const [team_a_id, team_b_id] =
    me < targetTeamId ? [me, targetTeamId] : [targetTeamId, me];

  // Idempotent, race-free start: ON CONFLICT DO NOTHING (ignoreDuplicates) means
  // two simultaneous "Message" clicks converge on one row and neither raises
  // 23505. We re-select afterward because DO NOTHING returns no row on conflict.
  // RLS INSERT policy requires current_user_team_id() ∈ {team_a_id, team_b_id}.
  const { error: upsertErr } = await supabase
    .from("conversations")
    .upsert(
      { team_a_id, team_b_id },
      { onConflict: "team_a_id,team_b_id", ignoreDuplicates: true },
    );
  if (upsertErr) redirect("/teams");

  const { data: convo, error: selErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("team_a_id", team_a_id)
    .eq("team_b_id", team_b_id)
    .single();
  if (selErr || !convo) redirect("/teams");

  redirect(`/messages/${convo.id}`);
}

/**
 * Mark the caller's side of a conversation as read (unread-dot on the inbox
 * list, CONTRACTS-adjacent). Called directly from the thread page's Server
 * Component on load — not a form submission, so no ActionState envelope.
 * mark_conversation_read() is the sole legal writer of *_last_read_at: it
 * guards "only my own side, only my own conversation" server-side, which is
 * why there's no client-facing UPDATE policy on conversations at all.
 */
export async function markConversationRead(conversationId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_conversation_read", {
    _conversation_id: conversationId,
  });
  if (error) console.error("mark_conversation_read failed:", error);
}

const SendSchema = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1).max(LIMITS.messageContentMax),
});

/**
 * Send a message into a conversation. Form-consumed mutation → ActionState shape.
 *
 * `sender_team_id` is taken from the verified JWT claim, NEVER from the client:
 * RLS rejects an INSERT whose sender_team_id ≠ current team, so a forged input
 * cannot write under another team's identity.
 */
export async function sendMessage(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SendSchema.safeParse({
    conversationId: formData.get("conversationId"),
    content: formData.get("content"),
  });
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid input",
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const senderTeamId = await requireCurrentTeamId();
  const { conversationId, content } = parsed.data;

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    sender_team_id: senderTeamId,
    content,
  });
  if (error) return { success: false, message: "Message failed to send." };

  // Realtime delivers the row to both open threads live; revalidation refreshes
  // the server-rendered inbox ordering and the thread's initial load on the next
  // navigation/refresh (CONTRACTS §3.D).
  revalidatePath("/messages");
  revalidatePath(`/messages/${conversationId}`);
  return { success: true, message: "Sent" };
}
