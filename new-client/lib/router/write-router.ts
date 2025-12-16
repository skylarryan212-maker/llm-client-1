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
  const slice = clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
  return slice;
}

export async function runWriterRouter(input: WriterRouterInput, topicAction: "continue_active" | "new" | "reopen_existing"): Promise<WriterRouterOutput> {
  const systemPrompt = `You decide topic metadata updates and memory/permanent instruction writes. Respond with ONE JSON object only:
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
- label is only for create; set null for update/skip.
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
    "Recent messages (oldest→newest):",
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
    });
    const cleaned = (text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const topicWrite = parsed.topicWrite || {};
    // Enforce action logic
    let action: "create" | "update" | "skip" =
      topicAction === "new" ? "create" : topicWrite.action || "skip";
    if (topicAction !== "new" && action === "create") {
      action = "skip";
    }
    const targetTopicId = action === "create" ? null : topicWrite.targetTopicId ?? input.currentTopic.id;
    const label = action === "create" ? topicWrite.label ?? autoLabelFromMessage(input.userMessageText) : null;
    const summary =
      action === "create" ? topicWrite.summary ?? autoSummaryFromMessage(input.userMessageText) : topicWrite.summary ?? null;
    const description =
      action === "create"
        ? topicWrite.description ?? autoSummaryFromMessage(input.userMessageText)
        : topicWrite.description ?? null;

    return {
      topicWrite: {
        action,
        targetTopicId,
        label,
        summary,
        description,
      },
      memoriesToWrite: Array.isArray(parsed.memoriesToWrite) ? parsed.memoriesToWrite : [],
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
