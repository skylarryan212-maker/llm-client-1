import { createServerClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];

export async function getConversationsForUser(options?: {
  projectId?: string | null;
}) {
  const supabase = createServerClient();
  const userId = getCurrentUserId();

  const query = supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options?.projectId) {
    query.eq("project_id", options.projectId);
  } else {
    query.is("project_id", null);
  }

  const { data, error } = await query.returns<ConversationRow[]>();

  if (error) {
    throw new Error(`Failed to load conversations: ${error.message}`);
  }

  return data ?? [];
}

export async function getConversationById(conversationId: string) {
  const supabase = createServerClient();
  const userId = getCurrentUserId();

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
