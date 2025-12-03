import type {
  Conversation,
  Database,
  PermanentInstruction as PermanentInstructionRow,
} from "@/lib/supabase/types";

type SupabaseClientLike = {
  from: (table: string) => any;
};

export type PermanentInstructionScope = "user" | "conversation";

export interface PermanentInstructionCacheItem {
  id: string;
  scope: PermanentInstructionScope;
  title: string | null;
  content: string;
  conversation_id: string | null;
}

export interface PermanentInstructionCachePayload {
  version: string;
  instructions: PermanentInstructionCacheItem[];
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeInstruction(row: PermanentInstructionRow): PermanentInstructionCacheItem {
  return {
    id: row.id,
    scope: (row.scope ?? "user") as PermanentInstructionScope,
    title: row.title,
    content: row.content,
    conversation_id: row.conversation_id,
  };
}

function normalizeMetadata(meta: Conversation["metadata"]): Record<string, any> {
  if (isPlainObject(meta)) {
    return { ...meta };
  }
  return {};
}

function parseCache(value: unknown): PermanentInstructionCachePayload | null {
  if (!isPlainObject(value)) return null;
  const version = typeof value.version === "string" ? value.version : null;
  if (!version) return null;
  const list = Array.isArray(value.instructions)
    ? value.instructions
        .filter(isPlainObject)
        .map((entry) => ({
          id: typeof entry.id === "string" ? entry.id : "",
          scope: (entry.scope === "conversation" ? "conversation" : "user") as PermanentInstructionScope,
          title: typeof entry.title === "string" ? entry.title : entry.title === null ? null : null,
          content: typeof entry.content === "string" ? entry.content : "",
          conversation_id: typeof entry.conversation_id === "string" ? entry.conversation_id : null,
        }))
    : [];
  if (!list.length && version === "none") {
    return { version, instructions: [] };
  }
  if (!version || list.some((item) => !item.id || !item.content)) {
    return null;
  }
  return { version, instructions: list };
}

async function fetchInstructionVersion(
  supabase: SupabaseClientLike,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("permanent_instruction_versions")
    .select("version")
    .eq("user_id", userId)
    .maybeSingle<{ version: string | null }>();

  if (error && error.code !== "PGRST116") {
    console.warn("[permanent-instructions] Failed to load version:", error);
    return null;
  }

  return data?.version ?? null;
}

interface LoadOptions {
  supabase: SupabaseClientLike;
  userId: string;
  conversationId: string;
  conversation: Conversation;
  forceRefresh?: boolean;
}

export async function loadPermanentInstructions({
  supabase,
  userId,
  conversationId,
  conversation,
  forceRefresh = false,
}: LoadOptions): Promise<{ instructions: PermanentInstructionCacheItem[]; metadata: Conversation["metadata"] }> {
  const metadata = normalizeMetadata(conversation.metadata);
  const cached = parseCache((metadata as Record<string, any>).permanentInstructionCache);
  const latestVersion = await fetchInstructionVersion(supabase, userId);
  const versionKey = latestVersion ?? "none";

  if (!forceRefresh && cached && cached.version === versionKey) {
    return { instructions: cached.instructions, metadata: conversation.metadata };
  }

  const { data, error } = await supabase
    .from("permanent_instructions")
    .select("*")
    .eq("user_id", userId)
    .eq("enabled", true)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[permanent-instructions] Query failed:", error);
    return { instructions: cached?.instructions ?? [], metadata: conversation.metadata };
  }

  const sanitized = ((data as PermanentInstructionRow[]) || [])
    .filter(
      (row) => !row.conversation_id || row.conversation_id === conversationId
    )
    .map(sanitizeInstruction);

  const nextMetadata = {
    ...metadata,
    permanentInstructionCache: {
      version: versionKey,
      instructions: sanitized,
    },
  };

  try {
    await supabase
      .from("conversations")
      .update({ metadata: nextMetadata })
      .eq("id", conversationId)
      .eq("user_id", userId);
    conversation.metadata = nextMetadata;
  } catch (persistErr) {
    console.warn("[permanent-instructions] Failed to persist cache:", persistErr);
  }

  return { instructions: sanitized, metadata: conversation.metadata };
}

export interface PermanentInstructionWriteDirective {
  title?: string | null;
  content: string;
  scope?: PermanentInstructionScope;
}

export interface PermanentInstructionDeleteDirective {
  id: string;
}

interface MutationOptions {
  supabase: SupabaseClientLike;
  userId: string;
  conversationId: string;
  writes?: PermanentInstructionWriteDirective[];
  deletes?: PermanentInstructionDeleteDirective[];
}

export async function applyPermanentInstructionMutations({
  supabase,
  userId,
  conversationId,
  writes = [],
  deletes = [],
}: MutationOptions): Promise<boolean> {
  let mutated = false;

  const trimmedWrites = writes
    .map((item) => ({
      title: (item.title ?? "").trim() || null,
      content: item.content?.trim() ?? "",
      scope: item.scope === "conversation" ? "conversation" : "user",
    }))
    .filter((item) => item.content.length > 0);

  if (trimmedWrites.length) {
    const rows: Database["public"]["Tables"]["permanent_instructions"]["Insert"][] =
      trimmedWrites.map((entry) => ({
        user_id: userId,
        scope: entry.scope,
        title: entry.title,
        content: entry.content,
        conversation_id: entry.scope === "conversation" ? conversationId : null,
      }));

    const { error } = await supabase.from("permanent_instructions").insert(rows);
    if (error) {
      console.error("[permanent-instructions] Insert error:", error);
    } else {
      mutated = true;
      console.log(
        `[permanent-instructions] Created ${rows.length} permanent instruction${rows.length === 1 ? "" : "s"}`
      );
    }
  }

  const idsToDelete = deletes
    .map((d) => d.id?.trim())
    .filter((id): id is string => Boolean(id));

  if (idsToDelete.length) {
    const { error } = await supabase
      .from("permanent_instructions")
      .delete()
      .eq("user_id", userId)
      .in("id", idsToDelete);

    if (error) {
      console.error("[permanent-instructions] Delete error:", error);
    } else {
      mutated = true;
      console.log(
        `[permanent-instructions] Deleted ${idsToDelete.length} permanent instruction${idsToDelete.length === 1 ? "" : "s"}`
      );
    }
  }

  return mutated;
}
