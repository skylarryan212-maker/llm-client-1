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

  if (options) {
    if (options.projectId) {
      if (!isValidUuid(options.projectId)) {
        return [];
      }
      query.eq("project_id", options.projectId);
    } else {
      query.is("project_id", null);
    }
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

export async function renameConversation(params: { conversationId: string; title: string }) {
  if (!isValidUuid(params.conversationId)) {
    throw new Error("Invalid conversation ID");
  }

  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { data, error } = await supabase
    .from("conversations")
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
  const userId = getCurrentUserId();

  const { error } = await supabase
    .from("conversations")
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
  const userId = getCurrentUserId();

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete conversation: ${error.message}`);
  }
}
