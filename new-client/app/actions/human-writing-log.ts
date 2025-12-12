"use server";

import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

type MessageInput = {
  role: "user" | "assistant";
  content: string;
  openaiResponseId?: string | null;
  metadata?: Record<string, unknown> | null;
};

async function ensureHumanWritingConversation(taskId: string, title?: string | null) {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  // Try to reuse a conversation for this task/user
  const { data: existing, error: findError } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("metadata->>task_id", taskId)
    .eq("metadata->>agent", "human-writing")
    .order("created_at", { ascending: false })
    .limit(1);

  if (findError) {
    throw new Error(`Failed to find conversation: ${findError.message}`);
  }

  if (existing && existing.length > 0) {
    return existing[0].id as string;
  }

  // Create a new conversation
  const { data: created, error: createError } = await supabase
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: title ?? "Human Writing",
        project_id: null,
        metadata: { task_id: taskId, agent: "human-writing" },
      },
    ])
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create conversation: ${createError?.message ?? "unknown error"}`);
  }

  return created.id as string;
}

export async function logHumanWritingMessages(params: {
  taskId: string;
  title?: string | null;
  conversationId?: string | null;
  messages: MessageInput[];
}) {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const conversationId =
    params.conversationId ??
    (await ensureHumanWritingConversation(params.taskId, params.title));

  if (!params.messages.length) {
    return { conversationId, messages: [] };
  }

  const rows = params.messages.map((msg) => ({
    user_id: userId,
    conversation_id: conversationId,
    role: msg.role,
    content: msg.content,
    openai_response_id: msg.openaiResponseId ?? null,
    metadata: msg.metadata ?? {},
  }));

  const { data, error } = await supabase.from("messages").insert(rows).select("id");
  if (error) {
    throw new Error(`Failed to log messages: ${error.message}`);
  }

  return { conversationId, messages: data ?? [] };
}
