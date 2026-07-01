"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { sendMessage } from "@/actions/messages";
import { Avatar, textareaClasses } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { cn, timeAgo } from "@/lib/utils";
import { EMPTY_ACTION_STATE } from "@/lib/types";
import type { Message } from "@/lib/types";

/**
 * Live conversation thread. The Server Action `sendMessage` is the write path;
 * the new row arrives back through the Postgres Changes subscription (the read
 * path), so both participants — including the sender — see it via Realtime.
 */
export function MessageThread({
  conversationId,
  myTeamId,
  otherTeamName,
  initialMessages,
}: {
  conversationId: string;
  myTeamId: string;
  otherTeamName: string;
  initialMessages: Message[];
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [state, action] = useActionState(sendMessage, EMPTY_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Subscribe to INSERTs on this conversation. Postgres Changes evaluates the
  // messages SELECT RLS per subscriber (the authenticated browser client passes
  // the session JWT to the socket), so the `filter` is relevance-narrowing, not
  // the security boundary — RLS is. Dedupe by id since our own insert also
  // arrives here. Cleanup removes the channel on unmount / id change.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // The Postgres Changes socket must carry the user's JWT before it joins —
    // otherwise it authorizes as anon and messages_select_participant (a
    // `to authenticated` policy) silently filters out every row. subscribe()
    // synchronously after createClient() can race the cookie session read, so
    // resolve the session and call realtime.setAuth() before subscribing.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`messages:conversation_${conversationId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "messages",
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            const incoming = payload.new as Message;
            setMessages((prev) =>
              prev.some((m) => m.id === incoming.id)
                ? prev
                : [...prev, incoming],
            );
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Auto-scroll to the newest message whenever the list grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Clear the composer once a send succeeds.
  useEffect(() => {
    if (state.success) formRef.current?.reset();
  }, [state]);

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col rounded-[var(--radius)] border border-border bg-surface">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Avatar name={otherTeamName} size={32} />
        <span className="font-medium">{otherTeamName}</span>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="m-auto text-sm text-muted">
            No messages yet. Say hello.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_team_id === myTeamId;
            return (
              <div
                key={m.id}
                className={cn(
                  "flex flex-col gap-0.5",
                  mine ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[75%] whitespace-pre-wrap break-words rounded-[var(--radius)] px-3 py-2 text-sm",
                    mine
                      ? "bg-primary text-primary-fg"
                      : "bg-surface-2 text-fg",
                  )}
                >
                  {m.content}
                </div>
                <span className="px-1 text-xs text-muted">
                  {timeAgo(m.created_at)}
                </span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        ref={formRef}
        action={action}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <textarea
          name="content"
          required
          rows={2}
          maxLength={4000}
          placeholder="Write a message…"
          className={cn(textareaClasses, "flex-1")}
        />
        <SubmitButton pendingLabel="Sending…">Send</SubmitButton>
      </form>
      {state.message && !state.success && (
        <p role="alert" className="px-3 pb-3 text-sm text-danger">
          {state.message}
        </p>
      )}
    </div>
  );
}
