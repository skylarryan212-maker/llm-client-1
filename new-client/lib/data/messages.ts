import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: string | null | undefined) {
  return typeof value === "string" && uuidPattern.test(value);
}

const DEFAULT_MESSAGE_PAGE_SIZE = 200;

export async function getMessagesForConversation(conversationId: string) {
  if (!isValidUuid(conversationId)) {
    return [];
  }

  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

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

export async function getMessagesForConversationPage(
  conversationId: string,
  options?: { limit?: number; before?: string | null }
) {
  if (!isValidUuid(conversationId)) {
    return { messages: [] as MessageRow[], hasMore: false, oldestTimestamp: null as string | null };
  }

  const limit = options?.limit ?? DEFAULT_MESSAGE_PAGE_SIZE;
  const before = options?.before ?? null;

  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  let query = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data, error } = await query.returns<MessageRow[]>();

  if (error) {
    throw new Error(`Failed to load messages: ${error.message}`);
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).reverse();
  const oldestTimestamp = page[0]?.created_at ?? null;

  return { messages: page, hasMore, oldestTimestamp };
}
