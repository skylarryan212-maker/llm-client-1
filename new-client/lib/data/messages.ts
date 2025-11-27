import { createServerClient } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

export async function getMessagesForConversation(conversationId: string) {
  const supabase = createServerClient();
  const userId = getCurrentUserId();

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();

  if (error) {
    throw new Error(`Failed to load messages: ${error.message}`);
  }

  return data ?? [];
}
