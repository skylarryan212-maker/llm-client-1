import { createServerClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

export type ConversationRow =
  Database["public"]["Tables"]["conversations"]["Row"];
export type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export async function createGlobalConversationWithFirstMessage(params: {
  title?: string | null;
  firstMessageContent: string;
}): Promise<{ conversation: ConversationRow; message: MessageRow }> {
  const supabase = createServerClient();
  const userId = getCurrentUserId();

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({
      user_id: userId,
      title: params.title ?? null,
      project_id: null,
      metadata: {},
    })
    .select()
    .single<ConversationRow>();

  if (conversationError || !conversation) {
    throw new Error(
      `Failed to create conversation: ${conversationError?.message ?? "Unknown error"}`
    );
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .insert({
      user_id: userId,
      conversation_id: conversation.id,
      role: "user",
      content: params.firstMessageContent,
      metadata: {},
    })
    .select()
    .single<MessageRow>();

  if (messageError || !message) {
    throw new Error(
      `Failed to create first message: ${messageError?.message ?? "Unknown error"}`
    );
  }

  return { conversation, message };
}

export async function appendMessageToConversation(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
}): Promise<MessageRow> {
  const supabase = createServerClient();
  const userId = getCurrentUserId();

  const { data, error } = await supabase
    .from("messages")
    .insert({
      user_id: userId,
      conversation_id: params.conversationId,
      role: params.role,
      content: params.content,
      metadata: {},
    })
    .select()
    .single<MessageRow>();

  if (error || !data) {
    throw new Error(
      `Failed to append message: ${error?.message ?? "Unknown error"}`
    );
  }

  return data;
}
