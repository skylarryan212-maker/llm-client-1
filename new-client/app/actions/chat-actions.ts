"use server";

import {
  appendMessageToConversation,
  createGlobalConversationWithFirstMessage,
} from "@/lib/data/conversation-writes";

export async function startGlobalConversationAction(
  firstMessageContent: string
): Promise<{ conversationId: string }> {
  const { conversation } = await createGlobalConversationWithFirstMessage({
    title: firstMessageContent.slice(0, 80) || null,
    firstMessageContent,
  });

  return { conversationId: conversation.id };
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
