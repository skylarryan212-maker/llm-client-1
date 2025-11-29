"use server";

import { revalidatePath } from "next/cache";
import {
  appendMessageToConversation,
  createProjectConversationWithFirstMessage,
  createGlobalConversationWithFirstMessage,
} from "@/lib/data/conversation-writes";
import {
  deleteConversation,
  moveConversationToProject,
  renameConversation,
} from "@/lib/data/conversations";
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
    title: "New chat",
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

export async function renameConversationAction(conversationId: string, title: string) {
  await renameConversation({ conversationId, title });
  revalidatePath("/");
  revalidatePath("/c/[conversationId]", "page");
}

export async function moveConversationToProjectAction(
  conversationId: string,
  projectId: string | null
) {
  await moveConversationToProject({ conversationId, projectId });
  revalidatePath("/");
  revalidatePath("/projects/[projectId]", "page");
}

export async function deleteConversationAction(conversationId: string) {
  await deleteConversation(conversationId);
  revalidatePath("/");
  revalidatePath("/c/[conversationId]", "page");
  revalidatePath("/projects/[projectId]", "page");
}
