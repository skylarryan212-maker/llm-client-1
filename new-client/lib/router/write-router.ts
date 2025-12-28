import { callDeepInfraLlama } from "../deepInfraLlama";

export type WriterRouterInput = {
  userMessageText: string;
  recentMessages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  memoryRelevantMessages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  assistantMessageText?: string | null;
  topics?: Array<{ id: string; label: string; summary: string | null; description: string | null }>;
  currentTopic: { id: string | null; summary: string | null; description: string | null };
};

export type WriterRouterOutput = {
  topicWrite: {
    action: "create" | "update" | "skip";
    targetTopicId: string | null;
    label: string | null;
    summary: string | null;
    description: string | null;
  };
  additionalTopicWrites: Array<{
    action: "update" | "skip";
    targetTopicId: string | null;
    label: string | null;
    summary: string | null;
    description: string | null;
  }>;
  memoriesToWrite: Array<{ type: string; title: string; content: string }>;
  memoriesToDelete: Array<{ id: string; reason: string }>;
  permanentInstructionsToWrite: Array<{ scope: "user" | "conversation"; title: string; content: string }>;
  permanentInstructionsToDelete: Array<{ id: string; reason: string }>;
  artifactsToWrite: Array<{ type: string; title: string; content: string }>;
};

function autoLabelFromMessage(message: string): string {
  const clean = (message || "").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").slice(0, 5);
  const label = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
  return label || "New Topic";
}

function autoSummaryFromMessage(message: string): string {
  const clean = (message || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New topic started.";
  const slice = clean.length > 200 ? `${clean.slice(0, 200)}...` : clean;
  return slice;
}
function normalizeNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (["none", "null", "n/a", "na", "skip"].includes(lower)) return null;
  return trimmed;
}

function normalizeNullableId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.toString().trim();
  if (!trimmed || ["none", "null", "n/a", "na", "skip"].includes(trimmed.toLowerCase())) return null;
  return trimmed;
}

function normalizeMemoryType(type: string | null | undefined, title: string | null | undefined, content: string | null | undefined): string {
  const fallback = "other";
  const raw = (type || "").toString().trim();
  const lowered = raw.toLowerCase();
  const tooGeneric = ["fact", "info", "general", "misc", "note", "memory", "other", "data", "text"];
  let base = lowered.replace(/[^a-z0-9]+/g, " ").trim();
  if (!base || tooGeneric.includes(base)) {
    const source = ((title || "") || (content || "")).toString();
    const slug = source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 3)
      .join("_");
    base = slug || fallback;
  }
  if (base.length > 32) base = base.slice(0, 32);
  return base || fallback;
}

function normalizeArtifactType(type: string | null | undefined): string {
  const allowed = new Set(["schema", "design", "notes", "instructions", "summary", "code", "spec", "config", "other"]);
  const cleaned = (type || "").toString().trim().toLowerCase();
  return allowed.has(cleaned) ? cleaned : "other";
}

function parseJsonLoose(raw: string) {
  const withoutFences = raw.replace(/```json|```/gi, "").trim();
  try {
    return JSON.parse(withoutFences);
  } catch {
    const match = withoutFences.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function runWriterRouter(
  input: WriterRouterInput,
  topicAction: "continue_active" | "new" | "reopen_existing",
  options?: { allowLLM?: boolean }
): Promise<WriterRouterOutput> {
  const systemPrompt = [
    "You decide topic metadata updates, artifacts, and memory/permanent instruction writes. Respond with ONE JSON object only.",
    "CRITICAL: Return STRICT JSON matching the schema. No prose, no markdown, no comments.",
    "{",
    '  "topicWrite": {',
    '    "action": "create" | "update" | "skip",',
    '    "targetTopicId": "string|null",',
    '    "label": "string|null",',
    '    "summary": "string|null",',
    '    "description": "string|null"',
    "  },",
    '  "additionalTopicWrites": [{ "action": "update" | "skip", "targetTopicId": "string|null", "label": "string|null", "summary": "string|null", "description": "string|null" }],',
    '  "memoriesToWrite": [{ "type": "string", "title": "string", "content": "string" }],',
    '  "memoriesToDelete": [{ "id": "string", "reason": "string" }],',
    '  "permanentInstructionsToWrite": [{ "scope": "user" | "conversation", "title": "string", "content": "string" }],',
    '  "permanentInstructionsToDelete": [{ "id": "string", "reason": "string" }],',
    '  "artifactsToWrite": [{ "type": "schema|design|notes|instructions|summary|code|spec|config|other", "title": "string", "content": "string" }]',
    "}",
    "Rules:",
    '- Use action="create" only if topicAction=new; otherwise "update" only if you truly need to refresh summary/description, else "skip".',
    '- Never emit placeholder text like "none"/"null"/"n/a".',
    "- label is only for create; set null for update/skip.",
    '- Permanent instructions: only write when the user explicitly requests a persistent rule (phrases like "always", "every time", "from now on", "never do X"). Otherwise leave permanentInstructionsToWrite empty.',
    '- Memories: write only durable, user-defining information that is likely to remain true across many future conversations. Do NOT write first-mention interests, transient states, intermediate steps, plans-in-progress, or conversational details. Prefer under-writing to over-writing. Write memory only if: (a) the information is stable over time, (b) not easily re-derived from context, (c) clearly improves future responses without re-asking, OR the user explicitly asks to remember it. Default behavior is no memory write. If uncertain, do not write memory.',
    '- When writing memories, rely only on the recent user messages for memory decisions; ignore assistant/system lines.',
    "- Do not write memory unless the same fact or preference appears in multiple turns or sessions, unless explicitly requested.",
    '- Memory type: choose a specific, descriptive type that matches the content (e.g., "name", "preference", "instruction", "task", "location", "code-snippet", "project-note"). Avoid generic types like "fact", "note", or "other".',
    '- Artifacts: only emit artifacts that would help future turns on this topic. Base them on the assistant reply content, not the user message. Skip if the assistant reply is too short (<80 chars) or doesn’t contain reusable material.',
    "- Topic updates: you may update summaries/descriptions for multiple provided topics when recent messages materially change them. Leave label/summary/description null if no change.",
    "- Arrays must be arrays (never null). No extra fields.",
  ].join("\n");

  const recentSection =
    input.recentMessages && input.recentMessages.length
      ? input.recentMessages
          .slice(-6)
          .map((m) => `- ${m.role}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 240)}`)
          .join("\n")
      : "No prior messages.";

  const memoryRelevantMessages =
    Array.isArray(input.memoryRelevantMessages) && input.memoryRelevantMessages.length
      ? input.memoryRelevantMessages
      : (input.recentMessages || []).filter((m) => m.role === "user");
  const memorySection =
    memoryRelevantMessages.length > 0
      ? memoryRelevantMessages
          .map((m) => `- user: ${(m.content || "").replace(/\s+/g, " ").slice(0, 240)}`)
          .join("\n")
      : "No recent user messages.";

  const userPrompt = [
    `Topic action: ${topicAction}`,
    `Current topic id: ${input.currentTopic.id || "none"}`,
    `Current summary: ${input.currentTopic.summary || "none"}`,
    `Current description: ${input.currentTopic.description || "none"}`,
    "",
    "Other available topics (id | label | summary | description):",
    (input.topics && input.topics.length
      ? input.topics
          .map(
            (t) =>
              `- ${t.id} | ${t.label} | ${t.summary ?? "none"} | ${t.description ?? "none"}`
          )
          .join("\n")
      : "none"),
    "",
    "Recent messages (oldest->newest):",
    recentSection,
    "",
    "Recent user messages for memory decisions (oldest->newest):",
    memorySection,
    "",
    "User message:",
    input.userMessageText,
    "",
    "Assistant reply (use for artifacts):",
    input.assistantMessageText || "none provided",
  ].join("\n");

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      topicWrite: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["create", "update", "skip"] },
          targetTopicId: { type: ["string", "null"] },
          label: { type: ["string", "null"] },
          summary: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
        },
        required: ["action", "targetTopicId", "label", "summary", "description"],
      },
      memoriesToWrite: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string" },
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["type", "title", "content"],
        },
        default: [],
      },
      memoriesToDelete: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            reason: { type: "string" },
          },
          required: ["id", "reason"],
        },
        default: [],
      },
      permanentInstructionsToWrite: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            scope: { type: "string", enum: ["user", "conversation"] },
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["scope", "title", "content"],
        },
        default: [],
      },
      permanentInstructionsToDelete: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
            reason: { type: "string" },
          },
          required: ["id", "reason"],
        },
        default: [],
      },
      artifactsToWrite: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: {
              type: "string",
              enum: ["schema", "design", "notes", "instructions", "summary", "code", "spec", "config", "other"],
            },
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["type", "title", "content"],
        },
        default: [],
      },
      additionalTopicWrites: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["update", "skip"] },
            targetTopicId: { type: ["string", "null"] },
            label: { type: ["string", "null"] },
            summary: { type: ["string", "null"] },
            description: { type: ["string", "null"] },
          },
          required: ["action", "targetTopicId", "label", "summary", "description"],
        },
        default: [],
      },
    },
    required: [
      "topicWrite",
      "additionalTopicWrites",
      "memoriesToWrite",
      "memoriesToDelete",
      "permanentInstructionsToWrite",
      "permanentInstructionsToDelete",
      "artifactsToWrite",
    ],
  };

  const fallback = (): WriterRouterOutput => {
    const shouldCreate = topicAction === "new";
    return {
      topicWrite: {
        action: shouldCreate ? "create" : "skip",
        targetTopicId: shouldCreate ? null : input.currentTopic.id,
        label: shouldCreate ? autoLabelFromMessage(input.userMessageText) : null,
        summary: shouldCreate ? autoSummaryFromMessage(input.userMessageText) : null,
        description: shouldCreate ? autoSummaryFromMessage(input.userMessageText) : null,
      },
      memoriesToWrite: [],
      memoriesToDelete: [],
      permanentInstructionsToWrite: [],
      permanentInstructionsToDelete: [],
      artifactsToWrite: [],
      additionalTopicWrites: [],
    };
  };

  const allowLLM = options?.allowLLM !== false;

  if (!allowLLM) {
    console.log("[writer-router] Skipping LLM writer (disabled); using fallback.");
    return fallback();
  }

  try {
    const { text } = await callDeepInfraLlama({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      schemaName: "writer_router",
      schema,
      enforceJson: true,
      model: "openai/gpt-oss-20b",
    });
    const cleaned = (text || "").trim();
    const parsed = parseJsonLoose(cleaned);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid JSON from writer router");
    }

    const topicWrite = (parsed as any).topicWrite || {};
    // Enforce action logic
    let action: "create" | "update" | "skip" =
      topicAction === "new" ? "create" : topicWrite.action || "skip";
    if (topicAction !== "new" && action === "create") {
      action = "update";
    }
    const targetTopicId =
      action === "create" ? null : normalizeNullableId(topicWrite.targetTopicId ?? input.currentTopic.id);
    const label =
      action === "create"
        ? normalizeNullableText(topicWrite.label) ?? autoLabelFromMessage(input.userMessageText)
        : null;
    const summary =
      action === "create"
        ? normalizeNullableText(topicWrite.summary) ?? autoSummaryFromMessage(input.userMessageText)
        : normalizeNullableText(topicWrite.summary);
    const description =
      action === "create"
        ? normalizeNullableText(topicWrite.description) ?? autoSummaryFromMessage(input.userMessageText)
        : normalizeNullableText(topicWrite.description);

    return {
      topicWrite: {
        action,
        targetTopicId,
        label,
        summary,
        description,
      },
      additionalTopicWrites: Array.isArray(parsed.additionalTopicWrites)
        ? parsed.additionalTopicWrites
            .filter((tw: any) => tw && tw.action === "update")
            .map((tw: any) => ({
              action: "update" as const,
              targetTopicId: normalizeNullableId(tw.targetTopicId),
              label: normalizeNullableText(tw.label),
              summary: normalizeNullableText(tw.summary),
              description: normalizeNullableText(tw.description),
            }))
        : [],
      memoriesToWrite: Array.isArray(parsed.memoriesToWrite)
        ? parsed.memoriesToWrite.map((m: any) => ({
            ...m,
            type: normalizeMemoryType(m?.type, m?.title, m?.content),
          }))
        : [],
      memoriesToDelete: Array.isArray(parsed.memoriesToDelete) ? parsed.memoriesToDelete : [],
      permanentInstructionsToWrite: Array.isArray(parsed.permanentInstructionsToWrite)
        ? parsed.permanentInstructionsToWrite
        : [],
      permanentInstructionsToDelete: Array.isArray(parsed.permanentInstructionsToDelete)
        ? parsed.permanentInstructionsToDelete
        : [],
      artifactsToWrite: Array.isArray(parsed.artifactsToWrite)
        ? parsed.artifactsToWrite.map((a: any) => ({
            type: normalizeArtifactType(a?.type),
            title: (a?.title || "").toString().trim(),
            content: (a?.content || "").toString(),
          }))
        : [],
    };
  } catch (err) {
    console.error("[writer-router] LLM routing failed, using fallback:", err);
    return fallback();
  }
}
