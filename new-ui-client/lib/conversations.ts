import { supabase } from "./supabaseClient";
import { TEST_USER_ID } from "./appConfig";

export type ConversationMeta = {
  id: string;
  title: string | null;
  project_id: string | null;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

export type ConversationRow = {
  id?: unknown;
  title?: unknown;
  project_id?: unknown;
  created_at?: unknown;
  metadata?: unknown;
};

export function normalizeConversationMeta(
  raw: ConversationRow | null | undefined
): ConversationMeta | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const { id, title, project_id, created_at, metadata } = raw;
  if (typeof id !== "string") {
    return null;
  }

  const normalizedTitle =
    typeof title === "string" ? title : title === null ? null : null;

  const normalizedProjectId =
    typeof project_id === "string"
      ? project_id
      : project_id === null
        ? null
        : null;

  const normalizedMetadata =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : metadata === null
        ? null
        : null;

  const normalizedCreatedAt =
    typeof created_at === "string" ? created_at : undefined;

  return {
    id,
    title: normalizedTitle,
    project_id: normalizedProjectId,
    created_at: normalizedCreatedAt,
    metadata: normalizedMetadata,
  };
}

type CreateConversationArgs = {
  title: string;
  projectId: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function createConversationRecord({
  title,
  projectId,
  metadata,
}: CreateConversationArgs): Promise<ConversationMeta> {
  const basePayload: Record<string, unknown> = {
    user_id: TEST_USER_ID,
    title,
    project_id: projectId,
  };
  const hasMetadata = !!(metadata && Object.keys(metadata).length > 0);
  const payload = hasMetadata
    ? { ...basePayload, metadata }
    : basePayload;
  const selectColumns = "id, title, project_id, created_at, metadata";
  const selectColumnsWithoutMetadata = "id, title, project_id, created_at";

  const insertConversation = async (
    body: Record<string, unknown>,
    selectClause: string
  ) =>
    supabase.from("conversations").insert(body).select(selectClause).single();

  const isMissingMetadataColumnError = (error: unknown) => {
    if (!error || typeof error !== "object") {
      return false;
    }
    const pgError = error as { code?: string; message?: string; details?: string };
    if (pgError.code && pgError.code.toString() === "42703") {
      return true;
    }
    const combined = `${pgError.message ?? ""} ${pgError.details ?? ""}`
      .toLowerCase()
      .trim();
    return combined.includes("metadata") && combined.includes("column");
  };
  const mentionsMetadata = (error: unknown) => {
    if (!error || typeof error !== "object") {
      return false;
    }
    const pgError = error as { message?: string; details?: string };
    const combined = `${pgError.message ?? ""} ${pgError.details ?? ""}`
      .toLowerCase()
      .trim();
    return combined.includes("metadata");
  };

  try {
    let selectClause = selectColumns;
    let { data, error } = await insertConversation(payload, selectClause);

    const shouldRetryWithoutMetadata =
      isMissingMetadataColumnError(error) ||
      (hasMetadata && mentionsMetadata(error));

    if (error && shouldRetryWithoutMetadata) {
      console.warn(
        "Retrying conversation insert without metadata column support",
        error
      );
      selectClause = selectColumnsWithoutMetadata;
      const fallback = await insertConversation(basePayload, selectClause);
      data = fallback.data;
      error = fallback.error;
    }

    if (error || !data) {
      throw error || new Error("Conversation not created");
    }

    const normalized = normalizeConversationMeta(data as ConversationRow);
    if (!normalized) {
      throw new Error("Conversation not created");
    }

    return normalized;
  } catch (error) {
    console.error("[CONVERSATION_CREATE] Failed to insert conversation", error);
    const normalizedError =
      error instanceof Error
        ? error
        : new Error("Conversation not created");
    throw normalizedError;
  }
}
