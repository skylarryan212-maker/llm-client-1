import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ArtifactInsert } from "@/lib/supabase/types";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

interface Params {
  supabase: SupabaseClient<Database>;
  message: MessageRow;
}

const CODE_BLOCK_REGEX = /```([\w-]+)?\n([\s\S]*?)```/g;
const MIN_CONTENT_LENGTH = 80;

export async function maybeExtractArtifactsFromMessage({
  supabase,
  message,
}: Params): Promise<void> {
  if (!message?.id || !message?.conversation_id) {
    return;
  }

  // Avoid duplicate extraction on retries
  const { data: existing } = await supabase
    .from("artifacts")
    .select("id")
    .eq("created_by_message_id", message.id)
    .limit(1);
  if (existing && existing.length) {
    return;
  }

  const text = message.content ?? "";
  if (!text.includes("```")) {
    return;
  }

  const inserts: ArtifactInsert[] = [];
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_REGEX.exec(text))) {
    const language = (match[1] || "").toLowerCase();
    const body = (match[2] || "").trim();
    if (body.length < MIN_CONTENT_LENGTH) {
      continue;
    }

    const artifactType = inferArtifactType(language, body);
    const title = buildArtifactTitle(artifactType, language);
    const summary = buildArtifactSummary(body);

    inserts.push({
      conversation_id: message.conversation_id,
      topic_id: message.topic_id ?? null,
      created_by_message_id: message.id,
      type: artifactType,
      title,
      summary,
      content: body,
    });
  }

  if (!inserts.length) {
    return;
  }

  try {
    type ArtifactInsertPayload =
      Database["public"]["Tables"]["artifacts"]["Insert"];

    const artifactInserts: ArtifactInsertPayload[] = inserts;

    await supabase.from("artifacts").insert<ArtifactInsertPayload>(artifactInserts);
  } catch (error) {
    console.error("[artifacts] Failed to insert extracted artifacts:", error);
  }
}

function inferArtifactType(language: string, body: string): ArtifactInsert["type"] {
  const normalized = language.toLowerCase();
  if (normalized.includes("json") && body.includes(`"properties"`)) {
    return "schema";
  }
  if (normalized.includes("yaml") || normalized.includes("yml")) {
    return "config";
  }
  if (normalized.includes("sql")) {
    return "code";
  }
  if (body.toLowerCase().includes("schema") && body.includes("{")) {
    return "schema";
  }
  if (body.toLowerCase().includes("requirements") || body.includes("#")) {
    return "spec";
  }
  return "code";
}

function buildArtifactTitle(type: string, language: string): string {
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  if (language) {
    return `${label} (${language.toUpperCase()})`;
  }
  return `${label} artifact`;
}

function buildArtifactSummary(body: string): string | null {
  const clean = body.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, 180);
}
