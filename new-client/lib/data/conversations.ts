import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string | null | undefined) {
  return typeof value === "string" && uuidPattern.test(value);
}

export async function getConversationsForUser(options?: { projectId?: string | null }) {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const query = supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options?.projectId) {
    if (!isValidUuid(options.projectId)) {
      return [];
    }
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
  if (!isValidUuid(conversationId)) {
    return null;
  }

  const supabase = await supabaseServer();
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
