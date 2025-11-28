import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";

export async function createGlobalConversationWithFirstMessage(params: {
  title?: string | null;
  firstMessageContent: string;
}) {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();
  const supabaseAny = supabase as any;

  const { data: conversation, error: conversationError } = await supabaseAny
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: params.title ?? null,
        project_id: null,
        metadata: {},
      } as any,
    ])
    .select()
    .single();

  if (conversationError || !conversation) {
    throw new Error(
      `Failed to create conversation: ${
        conversationError?.message ?? "Unknown error"
      }`
    );
  }

  const { data: message, error: messageError } = await supabaseAny
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: conversation.id,
        role: "user",
        content: params.firstMessageContent,
        metadata: {},
      } as any,
    ])
    .select()
    .single();

  if (messageError || !message) {
    throw new Error(
      `Failed to create first message: ${messageError?.message ?? "Unknown error"}`
    );
  }

  return { conversation, message };
}

export async function createProjectConversationWithFirstMessage(params: {
  projectId: string;
  title?: string | null;
  firstMessageContent: string;
}) {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();
  const supabaseAny = supabase as any;

  const { data: conversation, error: conversationError } = await supabaseAny
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: params.title ?? params.firstMessageContent.slice(0, 80) ?? null,
        project_id: params.projectId,
        metadata: {},
      } as any,
    ])
    .select()
    .single();

  if (conversationError || !conversation) {
    throw new Error(
      `Failed to create conversation: ${
        conversationError?.message ?? "Unknown error"
      }`
    );
  }

  const { data: message, error: messageError } = await supabaseAny
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: conversation.id,
        role: "user",
        content: params.firstMessageContent,
        metadata: {},
      } as any,
    ])
    .select()
    .single();

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
}) {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();
  const supabaseAny = supabase as any;

  const { data, error } = await supabaseAny
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: params.conversationId,
        role: params.role,
        content: params.content,
        metadata: {},
      } as any,
    ])
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to append message: ${error?.message ?? "Unknown error"}`
    );
  }

  return data;
}
