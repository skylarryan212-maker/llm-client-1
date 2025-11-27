"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";

export async function startGlobalConversationAction(
  firstMessageContent: string
): Promise<{ conversationId: string }> {
  // Cast locally to relax the broken Supabase generic inference for this file only
  const supabase = (await supabaseServer()) as any;
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
    .select();

  if (error || !data || !data[0]) {
    throw new Error("Failed to create conversation");
  }

  const conversation = data[0];
  return { conversationId: conversation.id as string };
}

export async function appendUserMessageAction(
  conversationId: string,
  content: string
): Promise<void> {
  const supabase = (await supabaseServer()) as any;
  const userId = getCurrentUserId();

  const { error } = await supabase
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: conversationId,
        role: "user",
        content,
        metadata: {},
      },
    ]);

  if (error) {
    throw new Error("Failed to append message");
  }
}
