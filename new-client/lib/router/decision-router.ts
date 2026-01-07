import { getModelAndReasoningConfig } from "../modelConfig";
import type { ReasoningEffort } from "../modelConfig";
import { callDeepInfraLlama } from "../deepInfraLlama";
import { computeTopicSemantics } from "../semantic/topicSimilarity";
import { supabaseServerAdmin } from "../supabase/server";

export type DecisionRouterInput = {
  userMessage: string;
  recentMessages: Array<{ role?: string | null; content?: string | null; topic_id?: string | null }>;
  activeTopicId: string | null;
  currentConversationId: string;
  speedMode: "auto" | "instant" | "thinking";
  modelPreference: "auto" | "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro";
  memories?: Array<{
    id: string;
    type: string;
    title: string;
    content: string;
  }>;
  topics: Array<{
    id: string;
    conversation_id: string;
    label: string;
    summary: string | null;
    description: string | null;
    parent_topic_id: string | null;
    conversation_title?: string | null;
    project_id?: string | null;
    is_cross_conversation?: boolean;
  }>;
  artifacts: Array<{
    id: string;
    conversation_id: string;
    topic_id: string | null;
    type: string;
    title: string;
    summary: string | null;
    keywords: string[];
    snippet: string;
  }>;
};

export type DecisionRouterOutput = {
  topicAction: "continue_active" | "new" | "reopen_existing";
  primaryTopicId: string | null;
  secondaryTopicIds: string[];
  newParentTopicId: string | null;
  model: "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro";
  effort: ReasoningEffort;
  memoryTypesToLoad: string[];
};

export async function runDecisionRouter(params: {
  input: DecisionRouterInput;
  allowLLM?: boolean;
}): Promise<DecisionRouterOutput> {
  const { input, allowLLM = true } = params;
  const recentMessages = Array.isArray(input.recentMessages)
    ? input.recentMessages.slice(-6)
    : [];
  const totalStart = Date.now();
  let semanticMs = 0;
  let llmMs: number | null = null;

  // Build prompt context
  const memorySection =
    input.memories && input.memories.length
      ? input.memories
          .slice(0, 30)
          .map((m) => `- [${m.type}] ${m.title}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 120)}`)
          .join("\n")
      : "No memories.";
  const memoryTypesFromMemories = Array.from(
    new Set(
      (input.memories || [])
        .map((m) => (m?.type || "").toString().trim())
        .filter((t) => !!t)
    )
  );
  const semanticStart = Date.now();
  const semanticMatches = await computeTopicSemantics(input.userMessage, input.topics, input.artifacts);
  semanticMs = Date.now() - semanticStart;
  const highConfidenceMatches = (semanticMatches || []).filter((m) => typeof m.similarity === "number" && m.similarity >= 0.5);
  if (semanticMatches && semanticMatches.length) {
    console.log("[semantic] top topic matches", semanticMatches.slice(0, 4));
  }
  const topicsById = new Map((input.topics || []).map((t) => [t.id, t]));
  const semanticSection =
    highConfidenceMatches && highConfidenceMatches.length
      ? highConfidenceMatches
          .slice(0, 6)
          .map((match) => {
            const flag = match.topicId === input.activeTopicId ? " (active topic)" : "";
            const kindLabel = match.kind === "artifact" ? "artifact" : "topic";
            const preview =
              (match.summary || match.description || "No summary available.")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 160);
            const linkedTopic =
              match.kind === "artifact" && match.relatedTopicId
                ? topicsById.get(match.relatedTopicId)?.label || match.relatedTopicId
                : null;
            const linkNote = linkedTopic ? ` (linked topic: ${linkedTopic})` : "";
            return `- [${kindLabel}:${match.topicId}]${flag} ${match.label}${linkNote} (score ${match.similarity.toFixed(
              3
            )}): ${preview}`;
          })
          .join("\n")
      : "No semantic matches >= 0.50 available.";
  const bestNonActiveMatch = semanticMatches?.find((match) => match.topicId !== input.activeTopicId);
  const bestNonActiveHint = bestNonActiveMatch
    ? `Closest non-active topic: [${bestNonActiveMatch.topicId}] ${bestNonActiveMatch.label} (score ${bestNonActiveMatch.similarity.toFixed(
        3
      )}).`
    : "No strong non-active topic detected.";

  const systemPrompt = `You are a single decision router. All inputs are provided as JSON. You MUST output ONE JSON object with a "labels" field only, matching the schema below. Do not include the input in your response.

Use the provided context to inform every rule:
- Work through the input in this order: recentMessages (latest assistant/user turns), topic summaries (label, description), artifacts, and the current userMessage. 
- Leverage semantic similarity scores and the "Closest non-active topic" hint to detect strong fits; these are high-priority indicators of reuse.
- Use memories, context mode, and selections to understand what references the client expects. If memories or topic metadata mention entities that match the new touchpoint, prefer reuse.
- Consider whether the user is referencing a previous assistant sentence, continuing a plan, or branching to something unrelated; recent assistant prompts and message history show whether continuation makes sense.

When consuming the input:
- Scan the recentMessages list so you can tell whether the active assistant reply and the new user message are tightly linked; look for follow-up language ("that", "continue", "next") or explicit references to previous ideas.
- Compare the active topic’s label, summary, and description against the incoming user message; matching entities or shared intent are strong cues to stay on that topic.
- Check artifacts and the semantic similarity section, including the closest non-active topic hint, to see if the user is resuming work that lives elsewhere.
- Use the current userMessage as the final tie-breaker: if nothing in the above context fits, emit topicAction "new" and start a fresh thread.

Output shape:
{
  "labels": {
    "topicAction": "continue_active" | "new" | "reopen_existing",
    "primaryTopicId": string | null,
    "secondaryTopicIds": string[],         // array, never null
    "newParentTopicId": string | null,
    "model": "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro",
    "effort": "none" | "low" | "medium" | "high" | "xhigh",
    "memoryTypesToLoad": string[]
  }
}
Rules:
- Never invent placeholder strings like "none"/"null" for IDs.
- If topicAction="new": primaryTopicId MUST be null.
  * continue_active: when the user is clearly continuing the active topic (follow-up, same intent, direct references like "that", "this", "continue", or replies to the last turn) and there is no stronger match elsewhere. Consider semantic scores, recent messages, topic labels, and mention of shared entity/context.
  * reopen_existing: when the user intent best matches a past topic in the provided topics/artifacts (same subject/entity/task), but the active topic is different or stale. Pick the best-matching previous topic as primaryTopicId.
  * new: when the request starts a new subject/task not covered by the active topic or any prior topic (no strong match).
- Use topic summaries/labels/descriptions plus artifacts to judge matching intent; prefer reuse when the fit is strong, otherwise start new.
- Topics may include cross-chat items marked is_cross_conversation=true and conversation_title set.
  * Prefer current-chat topics unless the user clearly refers to another chat or asks about prior messages outside this conversation.
  * If you select a cross-chat topic, use topicAction="reopen_existing" with that topic id.
 - Use the "Semantic similarity to prior topics/artifacts" section (below) as a signal: higher similarity means a stronger candidate to reopen, but you may still choose any provided topic if it best matches the user’s intent.
  * If an artifact is the strongest semantic match and it links to a topic, prefer reopen_existing with that linked topic unless the user explicitly wants a new topic.
- secondaryTopicIds: subset of provided topic ids, exclude primary; may be empty.
- newParentTopicId: null or a provided topic id.
- Model selection:
  * GPT-5 nano is the smallest, fastest, and cheapest GPT-5 model. It is ideal for high-volume, low-latency use and works best for simple tasks like short conversations, basic Q/A, paraphrasing, rewriting, summarizing short text, classification, extracting fields, and straightforward translations. It has limited deep reasoning ability and should not be used for complex multi-step logic, tricky coding, or long-document analysis.
  * GPT-5 mini is a compact GPT-5 model optimized for everyday assistant tasks with moderate reasoning. It is suitable for most chatbots and assistants, general Q/A, short and medium-length content generation, light to moderate coding help, explanations, brainstorming, and planning with a few constraints. It balances quality, speed, and cost, but is weaker than GPT-5.2 on difficult reasoning, large codebases, and long-context analysis.
  * GPT-5.2 is the most advanced and expensive model. It should be reserved for tasks that require strong reasoning, high accuracy, or long-context understanding. It works best for complex coding and debugging, multi-step math or logic, detailed analysis of long documents, multi-constraint planning, professional and enterprise workflows (finance, legal, research), and situations where mistakes are costly. Use it only when nano or mini would likely fail to fully solve the task.
  * Strongly prefer gpt-5-nano when the ask is short/straightforward: greetings/acknowledgements, short factual Q/A, short rewrites/summaries, classification/tagging, simple comparisons or 1-2 step instructions, no code or only trivial code edits (<10 lines), and user text length under ~120 words. Default to nano unless there is a clear reason to upgrade.
  * Use gpt-5-mini when the request needs multi-step reasoning (3-5 steps), small but non-trivial code (single file, short functions, small bug fixes), moderate math, medium-length writing/planning, or the user text is moderately long/ambiguous (~120-400 words) and needs reasoning. If unsure between nano vs mini, choose nano.
  * Use gpt-5.2 only for clearly complex/long tasks: multi-file or large code changes, refactors, debugging with stack traces, long-form writing (>400 words), deep planning/architecture, heavy math/proofs, or high-stakes domains (legal/financial/safety/security/privacy). If unsure between mini vs 5.2, choose mini.
  * ONLY use gpt-5.2-pro if the user explicitly prefers it AND the task is extremely high-stakes + complex. Otherwise downgrade to gpt-5.2/mini/nano.
- Effort selection:
  * Effort is for the downstream chat model's response (not for routing).
  * Default to low; use medium only when strong complexity indicators are present.
  * Guidance (speedMode="auto"):
    - low: most normal requests (2-5 simple steps), short coding, simple comparisons, light planning.
    - medium: debugging, non-trivial code, math/proofs, multi-constraint planning, long-form outputs, high-stakes domains.
  * If unsure between low vs medium, choose low.
  * High or xhigh only when the request is clearly rare, intricate, or high-stakes, and you are confident it needs extra depth.
  * For gpt-5-nano/gpt-5-mini: never emit "none"/"high"/"xhigh"; stay at low/medium. If a task would need high/xhigh, escalate the model instead of effort on nano/mini.
  * Speed mode:
    - instant -> effort MUST be one of: none, low (choose the lowest that fits the task).
    - thinking -> effort MUST be one of: medium, high, xhigh (choose the lowest that fits the task; prefer medium unless clearly needed).
  * Model preference: if modelPreference is not "auto", you MUST return that exact model.
- Arrays must be arrays (never null). No extra fields. No markdown.`;

  const inputPayload = {
    input: {
      userMessage: input.userMessage,
      recentMessages,
      activeTopicId: input.activeTopicId,
      current_conversation_id: input.currentConversationId,
      speedMode: input.speedMode,
      modelPreference: input.modelPreference,
      memories: input.memories ?? [],
      topics: input.topics,
      artifacts: input.artifacts,
    },
  };

  console.log("[decision-router] Input payload:", JSON.stringify(inputPayload.input, null, 2));

  const userPrompt = `Input JSON:
${JSON.stringify(inputPayload, null, 2)}

Memory summary:
${memorySection}

Semantic similarity to prior topics/artifacts (score >= 0.50 only; higher = stronger):
${semanticSection}

Closest non-active topic hint:
${bestNonActiveHint}

Return only the "labels" object matching the output schema.`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      labels: {
        type: "object",
        additionalProperties: false,
        properties: {
          topicAction: { type: "string", enum: ["continue_active", "new", "reopen_existing"] },
          primaryTopicId: { type: ["string", "null"] },
          secondaryTopicIds: { type: "array", items: { type: "string" }, default: [] },
          newParentTopicId: { type: ["string", "null"] },
          model: { type: "string", enum: ["gpt-5-nano", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"] },
          effort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh"] },
          memoryTypesToLoad: { type: "array", items: { type: "string" }, default: [] },
        },
        required: [
          "topicAction",
          "primaryTopicId",
          "secondaryTopicIds",
          "newParentTopicId",
          "model",
          "effort",
          "memoryTypesToLoad",
        ],
      },
    },
    required: ["labels"],
  };

  const fallback = (): DecisionRouterOutput => {
    const fallbackTopicAction: DecisionRouterOutput["topicAction"] = input.activeTopicId
      ? "continue_active"
      : "new";
    const fallbackPrimary = fallbackTopicAction === "continue_active" ? input.activeTopicId : null;
    const modelConfig = getModelAndReasoningConfig(input.modelPreference, input.speedMode, input.userMessage);
    const memoryTypesToLoad: string[] = Array.isArray(modelConfig.availableMemoryTypes)
      ? modelConfig.availableMemoryTypes
      : memoryTypesFromMemories;
    return {
      topicAction: fallbackTopicAction,
      primaryTopicId: fallbackPrimary,
      secondaryTopicIds: [] as string[],
      newParentTopicId: null,
      model: modelConfig.resolvedFamily,
      effort: (modelConfig.reasoning?.effort as ReasoningEffort) ?? "low",
      memoryTypesToLoad,
    };
  };

  if (!allowLLM) {
    console.log("[decision-router] Skipping LLM router (disabled); using fallback.");
    console.log("[decision-router] timing", {
      semanticMs,
      llmMs,
      totalMs: Date.now() - totalStart,
      allowLLM,
    });
    const output = fallback();
    void logDecisionRouterSample({
      promptVersion: "v_current",
      fallbackUsed: true,
      semanticMs,
      llmMs,
      input: inputPayload.input,
      output,
    });
    return output;
  }

  try {
    let usedFallback = false;
    const runRouterAttempt = async () => {
      const llmStart = Date.now();
      const { text } = await callDeepInfraLlama({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        schemaName: "decision_router",
        schema,
        temperature: 0.2,
        model: "openai/gpt-oss-20b",
        baseURL: "https://api.deepinfra.com/v1/openai",
        enforceJson: true,
        maxTokens: null,
        extraParams: { reasoning_effort: "low" },
      });
      llmMs = Date.now() - llmStart;
      return text;
    };

    const validateLabels = (labels: any) => {
      if (
        !labels ||
        typeof labels.topicAction !== "string" ||
        !["continue_active", "new", "reopen_existing"].includes(labels.topicAction) ||
        (labels.model && !["gpt-5-nano", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"].includes(labels.model)) ||
        (labels.effort && !["none", "low", "medium", "high", "xhigh"].includes(labels.effort))
      ) {
        return false;
      }
      return true;
    };

    let labels: any = null;
    const fallbackDecision = fallback();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await runRouterAttempt();
        const cleaned = (text || "").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        labels = parsed?.labels;
        if (validateLabels(labels)) {
          break;
        }
        console.warn("[decision-router] Invalid labels from LLM, retrying...");
      } catch (err) {
        if (attempt === 0) {
          console.warn("[decision-router] Router attempt failed, retrying once...", err);
          continue;
        }
        throw err;
      }
    }

    if (!validateLabels(labels)) {
      usedFallback = true;
      void logDecisionRouterSample({
        promptVersion: "v_current",
        fallbackUsed: true,
        semanticMs,
        llmMs,
        input: inputPayload.input,
        output: fallbackDecision,
      });
      return fallbackDecision;
    }

    // Basic validation/enforcement
    const topicIds = new Set((input.topics || []).map((t) => t.id));
    let primaryTopicId = labels.primaryTopicId ?? null;
    if (labels.topicAction === "continue_active") {
      primaryTopicId = input.activeTopicId ?? null;
      if (!primaryTopicId) {
        labels.topicAction = "new";
      }
    } else if (labels.topicAction === "reopen_existing" && primaryTopicId && !topicIds.has(primaryTopicId)) {
      primaryTopicId = null;
    } else if (labels.topicAction === "new") {
      primaryTopicId = null;
    }

    const validEfforts: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
    const effort: ReasoningEffort = validEfforts.includes(labels.effort) ? labels.effort : fallbackDecision.effort;

    // Enforce model preference if provided
    const userForcedModel = input.modelPreference !== "auto";
    let model: DecisionRouterOutput["model"] = userForcedModel
      ? (input.modelPreference as DecisionRouterOutput["model"])
      : ((labels.model as DecisionRouterOutput["model"]) ?? fallbackDecision.model);

    // Clamp model: never auto-select 5.2-pro unless user explicitly preferred it.
    const userRequestedPro = input.modelPreference === "gpt-5.2-pro";
    if (!userForcedModel && model === "gpt-5.2-pro" && !userRequestedPro) {
      model = "gpt-5.2";
    }
    // Enforce new topic invariants
    let secondaryTopicIds =
      Array.isArray(labels.secondaryTopicIds)
        ? labels.secondaryTopicIds.filter((id: string) => topicIds.has(id) && id !== primaryTopicId)
        : [];
    let newParentTopicId =
      labels.newParentTopicId && topicIds.has(labels.newParentTopicId) ? labels.newParentTopicId : null;
    let topicAction: DecisionRouterOutput["topicAction"] = labels.topicAction;
    if (topicAction === "new") {
      primaryTopicId = null;
      secondaryTopicIds = [];
      newParentTopicId = null;
    }
    if (topicAction === "reopen_existing" && primaryTopicId && !topicIds.has(primaryTopicId)) {
      topicAction = "new";
      primaryTopicId = null;
      secondaryTopicIds = [];
      newParentTopicId = null;
    }

    const output: DecisionRouterOutput = {
      topicAction,
      primaryTopicId,
      secondaryTopicIds,
      newParentTopicId,
      model,
      effort,
      memoryTypesToLoad: Array.isArray(labels.memoryTypesToLoad) ? labels.memoryTypesToLoad : [],
    };
    void logDecisionRouterSample({
      promptVersion: "v_current",
      fallbackUsed: usedFallback,
      semanticMs,
      llmMs,
      input: inputPayload.input,
      output,
    });
    return output;
  } catch (err) {
    console.error("[decision-router] LLM routing failed, using fallback:", err);
    console.log("[decision-router] timing", {
      semanticMs,
      llmMs,
      totalMs: Date.now() - totalStart,
      allowLLM,
    });
    const output = fallback();
    void logDecisionRouterSample({
      promptVersion: "v_current",
      fallbackUsed: true,
      semanticMs,
      llmMs,
      input: inputPayload.input,
      output,
    });
    return output;
  }
  finally {
    // Log timing on successful path
    console.log("[decision-router] timing", {
      semanticMs,
      llmMs,
      totalMs: Date.now() - totalStart,
      allowLLM,
    });
  }
}

type DecisionRouterSample = {
  promptVersion: string;
  fallbackUsed: boolean;
  semanticMs: number;
  llmMs: number | null;
  input: any;
  output: DecisionRouterOutput;
};

async function logDecisionRouterSample(sample: DecisionRouterSample) {
  try {
    if (typeof process === "undefined") return;
    const supabase = await supabaseServerAdmin();
    const payload = {
      prompt_version: sample.promptVersion,
      input: sample.input,
      labels: sample.output,
      meta: {
        fallback: sample.fallbackUsed,
        semantic_ms: sample.semanticMs,
        llm_ms: sample.llmMs,
        timestamp: new Date().toISOString(),
      },
    };
    await supabase.from("decision_router_samples").insert(payload);
  } catch (err) {
    console.warn("[decision-router] sample log failed", err);
  }
}
