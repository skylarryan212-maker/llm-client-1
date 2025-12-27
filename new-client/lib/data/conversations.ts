import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string | null | undefined) {
  return typeof value === "string" && uuidPattern.test(value);
}

export async function getConversationsForUser(options?: {
  projectId?: string | null;
  includeHumanWriting?: boolean;
  includeMarketAgent?: boolean;
  includeSga?: boolean;
}) {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const conversationQuery = supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  // Exclude human-writing agent chats from general lists unless explicitly requested
  if (!options?.includeHumanWriting) {
    conversationQuery.neq("metadata->>agent", "human-writing");
  }
  // Exclude market-agent chats from general lists unless explicitly requested
  if (!options?.includeMarketAgent) {
    conversationQuery.neq("metadata->>agent", "market-agent");
  }
  // Exclude SGA chats from general lists unless explicitly requested
  if (!options?.includeSga) {
    conversationQuery.neq("metadata->>agent", "sga");
  }

  if (options) {
    if (options.projectId) {
      if (!isValidUuid(options.projectId)) {
        return [];
      }
      conversationQuery.eq("project_id", options.projectId);
    } else {
      conversationQuery.is("project_id", null);
    }
  }

  const { data: conversations, error } = await conversationQuery.returns<ConversationRow[]>();

  if (error) {
    throw new Error(`Failed to load conversations: ${error.message}`);
  }

  const conversationRows = conversations ?? [];

  // Order conversations by most recent message (fallback to conversation creation).
  if (conversationRows.length === 0) {
    return [];
  }

  const conversationIds = conversationRows.map((c) => c.id);

  const { data: latestMessages, error: latestMessagesError } = await supabase
    .from("messages")
    .select("conversation_id, created_at")
    .eq("user_id", userId)
    .in("conversation_id", conversationIds)
    .order("created_at", { ascending: false });

  if (latestMessagesError) {
    console.warn("Failed to load recent messages for ordering, falling back to created_at:", latestMessagesError.message);
  }

  const latestByConversation = new Map<string, string>();
  (latestMessages ?? []).forEach((row) => {
    if (!row?.conversation_id || !row?.created_at) return;
    if (!latestByConversation.has(row.conversation_id)) {
      latestByConversation.set(row.conversation_id, row.created_at);
    }
  });

  const withLastActivity = conversationRows.map((conversation) => ({
    ...conversation,
    last_activity: latestByConversation.get(conversation.id) ?? conversation.created_at,
  }));

  withLastActivity.sort((a, b) => {
    const aTime = new Date(a.last_activity ?? a.created_at ?? 0).getTime();
    const bTime = new Date(b.last_activity ?? b.created_at ?? 0).getTime();
    return bTime - aTime;
  });

  return withLastActivity;
}

export async function getConversationById(conversationId: string) {
  if (!isValidUuid(conversationId)) {
    return null;
  }

  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle<ConversationRow>();

  if (error) {
    throw new Error(`Failed to load conversation: ${error.message}`);
  }

  return data;
}

export async function renameConversation(params: { conversationId: string; title: string }) {
  if (!isValidUuid(params.conversationId)) {
    throw new Error("Invalid conversation ID");
  }

  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const { data, error } = await (supabase
    .from("conversations") as any)
    .update({ title: params.title })
    .eq("id", params.conversationId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to rename conversation: ${error?.message ?? "Unknown error"}`);
  }

  return data;
}

export async function moveConversationToProject(params: { conversationId: string; projectId: string | null }) {
  if (!isValidUuid(params.conversationId)) {
    throw new Error("Invalid conversation ID");
  }

  if (params.projectId && !isValidUuid(params.projectId)) {
    throw new Error("Invalid project ID");
  }

  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const { error } = await (supabase
    .from("conversations") as any)
    .update({ project_id: params.projectId ?? null })
    .eq("id", params.conversationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to move conversation: ${error.message}`);
  }
}

export async function deleteConversation(conversationId: string) {
  if (!isValidUuid(conversationId)) {
    throw new Error("Invalid conversation ID");
  }

  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete conversation: ${error.message}`);
  }
}

export async function deleteAllConversations() {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  // Remove all messages first so there are no dangling rows referencing deleted conversations
  const { error: messageError } = await supabase
    .from("messages")
    .delete()
    .eq("user_id", userId);

  if (messageError) {
    throw new Error(`Failed to delete all messages: ${messageError.message}`);
  }

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete all conversations: ${error.message}`);
  }
}
