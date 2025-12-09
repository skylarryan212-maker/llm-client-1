import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

type AttachmentInput = {
  name?: string;
  mime?: string;
  dataUrl?: string;
  url?: string;
};

export async function createGlobalConversationWithFirstMessage(params: {
  title?: string | null;
  firstMessageContent: string;
  attachments?: AttachmentInput[];
}): Promise<{
  conversation: ConversationRow;
  message: MessageRow; // first user message
}> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  // 1) Create conversation
  const { data: conversation, error: conversationError } = await supabaseAny
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: params.title ?? null,
        project_id: null,
        metadata: {},
      },
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

  // 2) Insert first USER message
  const { data: message, error: messageError } = await supabaseAny
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: conversation.id,
        role: "user",
        content: params.firstMessageContent,
        metadata:
          params.attachments && params.attachments.length
            ? {
                files: params.attachments.map((file) => ({
                  name: file.name,
                  mimeType: file.mime,
                  url: file.url ?? file.dataUrl,
                  dataUrl: file.dataUrl,
                })),
              }
            : {},
      },
    ])
    .select()
    .single();

  if (messageError || !message) {
    throw new Error(
      `Failed to create first message: ${
        messageError?.message ?? "Unknown error"
      }`
    );
  }

  return { conversation, message };
}

export async function createProjectConversationWithFirstMessage(params: {
  projectId: string;
  firstMessageContent: string;
  attachments?: AttachmentInput[];
}): Promise<{
  conversation: ConversationRow;
  message: MessageRow; // first user message
}> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  // 1) Create project-scoped conversation
  const { data: conversation, error: conversationError } = await supabaseAny
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: "New chat",
        project_id: params.projectId,
        metadata: {},
      },
    ])
    .select()
    .single();

  if (conversationError || !conversation) {
    throw new Error(
      `Failed to create project conversation: ${
        conversationError?.message ?? "Unknown error"
      }`
    );
  }

  // 2) Insert first USER message
  const { data: message, error: messageError } = await supabaseAny
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: conversation.id,
        role: "user",
        content: params.firstMessageContent,
        metadata:
          params.attachments && params.attachments.length
            ? {
                files: params.attachments.map((file) => ({
                  name: file.name,
                  mimeType: file.mime,
                  url: file.url ?? file.dataUrl,
                  dataUrl: file.dataUrl,
                })),
              }
            : {},
      },
    ])
    .select()
    .single();

  if (messageError || !message) {
    throw new Error(
      `Failed to create first project message: ${
        messageError?.message ?? "Unknown error"
      }`
    );
  }

  return { conversation, message };
}

export async function appendMessageToConversation(params: {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
}): Promise<MessageRow> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  // Insert the message (user or assistant)
  const { data, error } = await supabaseAny
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: params.conversationId,
        role: params.role,
        content: params.content,
        metadata: {},
      },
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
