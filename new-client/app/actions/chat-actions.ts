"use server";

import {
  appendMessageToConversation,
  createProjectConversationWithFirstMessage,
  createGlobalConversationWithFirstMessage,
} from "@/lib/data/conversation-writes";
import type { Database } from "@/lib/supabase/types";

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export async function startGlobalConversationAction(
  firstMessageContent: string
): Promise<{
  conversationId: string;
  message: MessageRow;
  conversation: ConversationRow;
}> {
  const { conversation, message } = await createGlobalConversationWithFirstMessage({
    title: firstMessageContent.slice(0, 80) || null,
    firstMessageContent,
  });

  return { conversationId: conversation.id as string, message, conversation };
}

export async function appendUserMessageAction(
  conversationId: string,
  content: string
): Promise<void> {
  await appendMessageToConversation({
    conversationId,
    role: "user",
    content,
  });
}

export async function appendAssistantMessageAction(
  conversationId: string,
  content: string
): Promise<void> {
  await appendMessageToConversation({
    conversationId,
    role: "assistant",
    content,
  });
}

export async function startProjectConversationAction(params: {
  projectId: string;
  firstMessageContent: string;
}): Promise<{
  conversationId: string;
  message: MessageRow;
  conversation: ConversationRow;
}> {
  const { conversation, message } =
    await createProjectConversationWithFirstMessage({
      projectId: params.projectId,
      firstMessageContent: params.firstMessageContent,
    });

  return { conversationId: conversation.id as string, message, conversation };
}
