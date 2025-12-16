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
  // We keep this deterministic: no LLM call, just use the prompt and existing topic info.
  const shouldCreate = topicAction === "new";
  const topicWrite = {
    action: shouldCreate ? ("create" as const) : ("skip" as const),
    targetTopicId: shouldCreate ? null : input.currentTopic.id,
    label: shouldCreate ? autoLabelFromMessage(input.userMessageText) : null,
    summary: shouldCreate ? autoSummaryFromMessage(input.userMessageText) : null,
    description: shouldCreate ? autoSummaryFromMessage(input.userMessageText) : null,
  };

  return {
    topicWrite,
    memoriesToWrite: [],
    memoriesToDelete: [],
    permanentInstructionsToWrite: [],
    permanentInstructionsToDelete: [],
  };
}
