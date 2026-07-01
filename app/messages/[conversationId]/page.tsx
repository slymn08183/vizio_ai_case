import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getCurrentTeamId } from "@/lib/auth/claims";
import { MessageThread } from "@/components/message-thread";
import { markConversationRead } from "@/actions/messages";
import type { Conversation, InboxItem, Message } from "@/lib/types";

export const metadata = { title: "Conversation — TeamSocial" };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  // Next 15: route params is a Promise — await it.
  const { conversationId } = await params;
  const supabase = await createClient();
  const myTeamId = await getCurrentTeamId();

  // Membership verification is RLS: the conversations SELECT policy returns this
  // row ONLY to participants. A non-member (or bad id) gets null → notFound(),
  // which also avoids leaking whether the conversation exists.
  const { data: convo } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle<Conversation>();
  if (!convo) notFound();

  // Fire-and-forget: don't block the render on the read-marker write: the
  // Inbox list's unread dot next reflects it on its own next fetch anyway.
  void markConversationRead(conversationId);

  // The counterpart is whichever side of the pair isn't me.
  const otherTeamId =
    convo.team_a_id === myTeamId ? convo.team_b_id : convo.team_a_id;

  // Resolve the counterpart's name. teams-SELECT RLS returns the row for public
  // (or own) teams; for a PRIVATE counterpart it's hidden, so fall back to the
  // SECURITY DEFINER get_inbox lookup (which surfaces private names), then to a
  // neutral placeholder so the thread always has a header label.
  let otherTeamName = "Private team";
  const { data: team } = await supabase
    .from("teams")
    .select("name")
    .eq("id", otherTeamId)
    .maybeSingle<{ name: string }>();
  if (team?.name) {
    otherTeamName = team.name;
  } else if (myTeamId) {
    const { data: inbox } = await supabase.rpc("get_inbox", {
      _viewer_team_id: myTeamId,
    });
    const match = (inbox as InboxItem[] | null)?.find(
      (i) => i.conversation_id === conversationId,
    );
    if (match?.other_team_name) otherTeamName = match.other_team_name;
  }

  // Render oldest→newest (bottom-anchored chat). RLS scopes rows to participants.
  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto mt-8 max-w-2xl">
      <MessageThread
        conversationId={conversationId}
        myTeamId={myTeamId ?? ""}
        otherTeamName={otherTeamName}
        initialMessages={(messages as Message[] | null) ?? []}
      />
    </div>
  );
}
