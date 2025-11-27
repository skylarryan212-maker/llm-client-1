"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";

export async function startGlobalConversationAction(
  firstMessageContent: string
): Promise<{ conversationId: string }> {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { data, error } = await supabase
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: firstMessageContent.slice(0, 80) || null,
        project_id: null,
        metadata: {},
      },
    ])
    .select()
    .single();

  if (error || !data) {
    throw new Error("Failed to create conversation");
  }

  return { conversationId: data.id };
}

export async function appendUserMessageAction(
  conversationId: string,
  content: string
): Promise<void> {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { data, error } = await supabase
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: conversationId,
        role: "user",
        content,
        metadata: {},
      },
    ])
    .select()
    .single();

  if (error || !data) {
    throw new Error("Failed to append message");
  }
}
