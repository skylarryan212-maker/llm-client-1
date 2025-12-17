import { callDeepInfraLlama } from "../deepInfraLlama";

export type WriterRouterInput = {
  userMessageText: string;
  recentMessages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
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
  memoriesToWrite: Array<{ type: string; title: string; content: string }>;
  memoriesToDelete: Array<{ id: string; reason: string }>;
  permanentInstructionsToWrite: Array<{ scope: "user" | "conversation"; title: string; content: string }>;
  permanentInstructionsToDelete: Array<{ id: string; reason: string }>;
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

export async function runWriterRouter(input: WriterRouterInput, topicAction: "continue_active" | "new" | "reopen_existing"): Promise<WriterRouterOutput> {
const systemPrompt = `You decide topic metadata updates and memory/permanent instruction writes. Respond with ONE JSON object only.
CRITICAL: Return STRICT JSON matching the schema. No prose, no markdown, no comments.
{
  "topicWrite": {
    "action": "create" | "update" | "skip",
    "targetTopicId": "string|null",
    "label": "string|null",
    "summary": "string|null",
    "description": "string|null"
  },
  "memoriesToWrite": [{ "type": "string", "title": "string", "content": "string" }],
  "memoriesToDelete": [{ "id": "string", "reason": "string" }],
  "permanentInstructionsToWrite": [{ "scope": "user" | "conversation", "title": "string", "content": "string" }],
  "permanentInstructionsToDelete": [{ "id": "string", "reason": "string" }]
}
Rules:
- Use action="create" only if topicAction=new; otherwise "update" only if you truly need to refresh summary/description, else "skip".
- Never emit placeholder text like "none"/"null"/"n/a".
- label is only for create; set null for update/skip.
- Permanent instructions: only write when the user explicitly requests a persistent rule (phrases like "always", "every time", "from now on", "never do X"). Otherwise leave permanentInstructionsToWrite empty.
- Memories: write only durable, user-defining information that is likely to remain true across many future conversations. Do NOT write first-mention interests, transient states, intermediate steps, plans-in-progress, or conversational details. Prefer under-writing to over-writing. Write memory only if: (a) the information is stable over time, (b) not easily re-derived from context, (c) clearly improves future responses without re-asking, OR the user explicitly asks to remember it. Default behavior is no memory write. If uncertain, do not write memory.
- Do not write memory unless the same fact or preference appears in multiple turns or sessions, unless explicitly requested.
- Memory type: choose a specific, descriptive type that matches the content (e.g., "name", "preference", "instruction", "task", "location", "code-snippet", "project-note"). Avoid generic types like "fact", "note", or "other".
- Arrays must be arrays (never null). No extra fields.`;

  const recentSection =
    input.recentMessages && input.recentMessages.length
      ? input.recentMessages
          .slice(-6)
          .map((m) => `- ${m.role}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 240)}`)
          .join("\n")
      : "No prior messages.";

  const userPrompt = [
    `Topic action: ${topicAction}`,
    `Current topic id: ${input.currentTopic.id || "none"}`,
    `Current summary: ${input.currentTopic.summary || "none"}`,
    `Current description: ${input.currentTopic.description || "none"}`,
    "",
    "Recent messages (oldest->newest):",
    recentSection,
    "",
    "User message:",
    input.userMessageText,
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
    },
    required: [
      "topicWrite",
      "memoriesToWrite",
      "memoriesToDelete",
      "permanentInstructionsToWrite",
      "permanentInstructionsToDelete",
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
    };
  };

  try {
    const { text } = await callDeepInfraLlama({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      schemaName: "writer_router",
      schema,
      enforceJson: true,
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
      action = "skip";
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
    };
  } catch (err) {
    console.error("[writer-router] LLM routing failed, using fallback:", err);
    return fallback();
  }
}
