/**
 * LLM-based Router for Model Selection
 * 
 * Uses GPT 5 Nano to intelligently decide which model and reasoning effort
 * should be used for a given prompt, replacing hardcoded heuristics with
 * AI-powered decision making.
 */

import type { ModelFamily, ReasoningEffort } from "./modelConfig";
import type { MemoryType } from "./memory";

export interface MemoryToWrite {
  type: string;      // Dynamic category name
  title: string;     // Brief title
  content: string;   // Memory content
}

export interface MemoryToDelete {
  id: string;        // Memory ID to delete
  reason: string;    // Why it should be deleted
}

export interface PermanentInstructionToWrite {
  scope?: "user" | "conversation";
  title?: string;
  content: string;
}

export interface PermanentInstructionToDelete {
  id: string;
  reason?: string;
}

export interface LLMRouterDecision {
  model: Exclude<ModelFamily, "auto">;
  effort: ReasoningEffort;
  memoryTypesToLoad?: string[];
  memoriesToWrite: MemoryToWrite[];
  memoriesToDelete: MemoryToDelete[];
  permanentInstructionsToWrite: PermanentInstructionToWrite[];
  permanentInstructionsToDelete: PermanentInstructionToDelete[];
  routedBy: "llm";
}

export interface RouterContext {
  userModelPreference?: ModelFamily;
  speedMode?: "auto" | "instant" | "thinking";
  usagePercentage?: number;
  availableMemoryTypes?: string[];  // ignored for memory routing (main model handles memory)
  permanentInstructionSummary?: string; // ignored
  permanentInstructions?: PermanentInstructionToWrite[]; // ignored
}

const ROUTER_MODEL_ID = "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo";
const ROUTER_SYSTEM_PROMPT = `You are a lightweight routing assistant.

You are NOT the assistant that replies to the user. You NEVER answer the user, never call tools, and never output explanations or markdown. Your ONLY job is to choose which model will answer, the reasoning effort level, and which memory categories to load or modify. Respond with ONE JSON object only.

Available models: "gpt-5-nano", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro".
Available efforts: "none" | "low" | "medium" | "high" | "xhigh" ( "none" is ONLY allowed when model === "gpt-5.2" or "gpt-5.2-pro").

Your JSON response MUST have this exact shape (no extra keys):
{
  "model": "gpt-5-nano" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro",
  "effort": "none" | "low" | "medium" | "high" | "xhigh",
  "routedBy": string,
  "memoryTypesToLoad": string[],
  "memoriesToWrite": { "type": string, "title": string, "content": string }[],
  "memoriesToDelete": { "id": string, "reason": string }[],
  "permanentInstructionsToWrite": { "scope": "user" | "conversation", "title": string, "content": string }[],
  "permanentInstructionsToDelete": { "id": string, "reason": string }[]
}

Hard rules:
1) routedBy: always set to a fixed identifier, e.g. "llm-router-v1".
2) Model selection:
   - Default to the cheapest model that can reliably handle the request.
   - Use "gpt-5.2" when: user explicitly asks for best/deep reasoning/5.2, the task is high-stakes (legal/medical/financial/safety), or requires long multi-step reasoning or large-context reading.
   - Use "gpt-5.2-pro" only when the user explicitly asks for Pro/strongest/hard thinking OR when the task is clearly the most complex/high-risk scenario that justifies extra cost.
   - Use "gpt-5-mini" for non-trivial code, multi-step math, complex JSON transforms, or medium-length writing/editing that is not high-stakes.
   - Use "gpt-5-nano" for short factual answers, simple rewrites, classifications, short summaries, or tiny JSON tasks.
   - When unsure between two options, choose the cheaper model unless the task is high-stakes.
3) Effort selection:
   - "none" only with model "gpt-5.2" or "gpt-5.2-pro" for trivial tasks.
   - "low": simple reasoning/formatting.
   - "medium": multi-step reasoning, non-trivial code, careful analysis.
   - "high": complex or high-stakes tasks needing detailed reasoning.
   - "xhigh": only when the task is extremely complex/high stakes and warrants maximum reasoning budget (only with 5.2/5.2-pro).
   - When in doubt between two effort levels, choose the lower level that is still safe.
4) memoryTypesToLoad: pick the minimal set of categories needed; array may be empty; maximum 3 entries.
5) memoriesToWrite: only when the user clearly provides durable personal info/preferences/project details that help future turns. Keep entries concise (<= 200 chars content). Maximum 2 entries.
6) memoriesToDelete: only when the user clearly revokes or corrects a prior memory; include id and brief reason. If none, use [].
7) permanentInstructionsToWrite: for stable, long-term behavior instructions the user wants in future chats. Each title should be a short stable identifier; content <= 240 chars. Maximum 2 entries.
8) permanentInstructionsToDelete: only when the user explicitly cancels/overrides prior instructions; provide ids. If none, use [].
9) Output rules: ONE JSON object only. No prose, no markdown, no comments. Do NOT attempt to solve the user’s task or include answer content.`;

/**
 * Calls GPT 5 Nano to decide model and reasoning effort
 */
export async function routeWithLLM(
  promptText: string,
  context?: RouterContext,
  recentMessages?: Array<{ role?: string | null; content?: string | null }>
): Promise<LLMRouterDecision | null> {
  try {
    const { callDeepInfraLlama } = await import("@/lib/deepInfraLlama");
    // Build context message
    let contextNote = "";
    if (context?.userModelPreference && context.userModelPreference !== "auto") {
      contextNote += `\nIMPORTANT: User explicitly selected "${context.userModelPreference}" - you MUST recommend this model (only decide reasoning effort).`;
    }
    if (context?.speedMode === "instant") {
      contextNote += `\nUser selected INSTANT mode - prefer "none" (for 5.2) or "low" effort.`;
    } else if (context?.speedMode === "thinking") {
      contextNote += `\nUser selected THINKING mode - prefer "medium" or "high" effort.`;
    }
  if (context?.usagePercentage && context.usagePercentage >= 80) {
    contextNote += `\nUser is at ${context.usagePercentage.toFixed(0)}% usage - prefer smaller models (nano/mini) to save costs.`;
  }
  const memoryTypeHint =
    context?.availableMemoryTypes && context.availableMemoryTypes.length
      ? `\nAvailable memory categories: ${context.availableMemoryTypes.join(", ")}. Choose only the categories you need in memoryTypesToLoad.`
      : "";

  const recentSnippet =
    recentMessages && recentMessages.length
      ? "\nRecent messages (most recent last):\n" +
        recentMessages
          .slice(-5)
          .map((m) => {
            const role = m.role ?? "unknown";
            const preview = (m.content || "").replace(/\s+/g, " ").slice(0, 160);
            return `- ${role}: ${preview}`;
          })
          .join("\n")
      : "";

  const routerPrompt = `${contextNote ? `${contextNote}\n\n` : ""}Analyze this prompt and recommend model + effort. Also choose minimal memoryTypesToLoad and any memory/permanent write/delete actions if clearly warranted.${memoryTypeHint}${recentSnippet}\n\nCurrent user prompt:\n${promptText}`;

    console.log("[llm-router] Starting LLM routing call");
    const startTime = Date.now();

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        model: { type: "string", enum: ["gpt-5-nano", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"] },
        effort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh"] },
        memoryTypesToLoad: {
          type: "array",
          items: { type: "string" },
          description: "Minimal set of memory categories to load for this turn",
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
        },
        routedBy: { type: "string" },
      },
      required: [
        "model",
        "effort",
        "routedBy",
        "memoryTypesToLoad",
        "memoriesToWrite",
        "memoriesToDelete",
        "permanentInstructionsToWrite",
        "permanentInstructionsToDelete",
      ],
    };

    const { text, usage } = await callDeepInfraLlama({
      messages: [
        { role: "system", content: ROUTER_SYSTEM_PROMPT },
        { role: "user", content: routerPrompt },
      ],
      schemaName: "router_decision",
      schema,
      model: ROUTER_MODEL_ID,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[llm-router] LLM routing completed in ${elapsed}ms`);

    if (usage) {
      lastRouterUsage = {
        model: ROUTER_MODEL_ID,
        inputTokens: usage.input_tokens ?? lastRouterUsage.inputTokens,
        outputTokens: usage.output_tokens ?? lastRouterUsage.outputTokens,
      };
    }

    const parsed = (() => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    })();
    if (!parsed) {
      console.error("[llm-router] No parsed decision");
      return null;
    }
    console.log("[llm-router] Parsed decision:", parsed);

    // Validate response
    const validModels: Array<Exclude<ModelFamily, "auto">> = [
      "gpt-5-nano",
      "gpt-5-mini",
      "gpt-5.2",
      "gpt-5.2-pro",
    ];
    const validEfforts: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
    if (!validModels.includes(parsed.model)) {
      console.error(`[llm-router] Invalid model: ${parsed.model}`);
      return null;
    }

    if (!validEfforts.includes(parsed.effort)) {
      console.error(`[llm-router] Invalid effort: ${parsed.effort}`);
      return null;
    }

    const isFullFamily = parsed.model === "gpt-5.2" || parsed.model === "gpt-5.2-pro";
    if (!isFullFamily && parsed.effort === "none") {
      console.warn(`[llm-router] ${parsed.model} cannot use "none" effort, forcing to "low"`);
      parsed.effort = "low";
    }
    if (!isFullFamily && parsed.effort === "xhigh") {
      console.warn(`[llm-router] ${parsed.model} cannot use "xhigh" effort, reducing to "high"`);
      parsed.effort = "high";
    }

    return {
      model: parsed.model as Exclude<ModelFamily, "auto">,
      effort: parsed.effort as ReasoningEffort,
      memoryTypesToLoad: Array.isArray(parsed.memoryTypesToLoad) ? parsed.memoryTypesToLoad : [],
      memoriesToWrite: Array.isArray(parsed.memoriesToWrite) ? parsed.memoriesToWrite : [],
      memoriesToDelete: Array.isArray(parsed.memoriesToDelete) ? parsed.memoriesToDelete : [],
      permanentInstructionsToWrite: Array.isArray(parsed.permanentInstructionsToWrite)
        ? parsed.permanentInstructionsToWrite
        : [],
      permanentInstructionsToDelete: Array.isArray(parsed.permanentInstructionsToDelete)
        ? parsed.permanentInstructionsToDelete
        : [],
      routedBy: typeof parsed.routedBy === "string" ? parsed.routedBy : "llm",
    };
  } catch (error) {
    console.error("[llm-router] Error during LLM routing:", error);
    return null;
  }
}

/**
 * Returns usage data for the router call (for cost tracking)
 */
let lastRouterUsage = {
  model: ROUTER_MODEL_ID,
  inputTokens: 100,
  outputTokens: 20,
};

export function getRouterUsageEstimate() {
  return lastRouterUsage;
}

/**
 * Memory Analysis Result
 */
export interface MemoryAnalysis {
  shouldWrite: boolean;
  type: MemoryType;
  title: string;
  content: string;
  reasoning?: string;
}

const MEMORY_ANALYSIS_PROMPT = `You are a memory extraction assistant. Analyze conversations to determine if the user shared information worth remembering long-term.

**Memory Types:**
- **identity**: Name, personal details, background ("My name is Alex", "I'm a software engineer")
- **preference**: Likes, dislikes, preferred styles ("I prefer dark mode", "I like concise responses")
- **constraint**: Rules, always/never statements ("Always use TypeScript", "Never use semicolons")
- **workflow**: Process preferences, habits ("I work best in the morning", "I prefer TDD")
- **project**: Project-specific context ("Working on React app", "Building an API")
- **instruction**: Specific directives ("Format dates as MM/DD/YYYY", "Use British spelling")
- **other**: General facts that don't fit above

**Guidelines:**
- Only extract information that's **persistent** and **actionable** for future conversations
- Ignore: greetings, questions, temporary requests, one-time tasks
- Look for statements about the user's identity, preferences, or constraints
- Reformulate messy statements into clear, concise memories
- Check if similar information already exists (don't duplicate)

**Examples:**

User: "My name is Alex and I prefer dark mode"
Assistant: "Got it, Alex! I'll remember your preference for dark mode."
→ WRITE:
{
  "shouldWrite": true,
  "type": "identity",
  "title": "User's name is Alex",
  "content": "User's name is Alex",
  "reasoning": "User shared their name"
}

User: "I'm not a fan of verbose explanations, keep it brief"
Assistant: "Understood, I'll keep responses concise."
→ WRITE:
{
  "shouldWrite": true,
  "type": "preference",
  "title": "Prefers brief responses",
  "content": "User prefers concise, brief explanations without verbosity",
  "reasoning": "User expressed preference for communication style"
}

User: "Never use var in JavaScript, always use const or let"
Assistant: "Absolutely, const and let are best practices."
→ WRITE:
{
  "shouldWrite": true,
  "type": "constraint",
  "title": "Never use var in JavaScript",
  "content": "Always use const or let instead of var in JavaScript code",
  "reasoning": "User set a hard constraint for code generation"
}

User: "What's the weather today?"
Assistant: "I don't have access to weather data."
→ DON'T WRITE:
{
  "shouldWrite": false,
  "reasoning": "Just a question, no information about user to remember"
}

User: "Thanks!"
Assistant: "You're welcome!"
→ DON'T WRITE:
{
  "shouldWrite": false,
  "reasoning": "Just pleasantries, nothing to remember"
}

User: "Can you write a Python script for me?"
Assistant: "Sure! Here's a script..."
→ DON'T WRITE:
{
  "shouldWrite": false,
  "reasoning": "One-time task request, not persistent information"
}

**Response Format:**
Respond with ONLY a valid JSON object (no markdown, no explanation):
{
  "shouldWrite": true | false,
  "type": "identity" | "preference" | "constraint" | "workflow" | "project" | "instruction" | "other",
  "title": "brief title (max 60 chars)",
  "content": "clear, actionable description",
  "reasoning": "one-line explanation"
}

If shouldWrite is false, type/title/content can be omitted.`;

/**
 * Analyzes a conversation to determine if a memory should be saved
 */
export async function analyzeForMemory(
  userMessage: string,
  assistantResponse: string,
  existingMemories?: Array<{ title: string; content: string }>
): Promise<MemoryAnalysis | null> {
  try {
    const { callDeepInfraLlama } = await import("@/lib/deepInfraLlama");

    // Build context about existing memories to avoid duplicates
    let existingContext = "";
    if (existingMemories && existingMemories.length > 0) {
      existingContext = "\n\n**Existing memories (avoid duplicating these):**\n" +
        existingMemories.map(m => `- ${m.title}: ${m.content}`).join("\n");
    }

    const analysisPrompt = `Analyze this conversation and determine if a memory should be saved:

**User:** ${userMessage}
**Assistant:** ${assistantResponse}${existingContext}

Should a memory be saved? If yes, extract and structure it.`;

    console.log("[memory-analysis] Starting memory analysis");
    const startTime = Date.now();

    const { text } = await callDeepInfraLlama({
      messages: [
        { role: "system", content: MEMORY_ANALYSIS_PROMPT },
        { role: "user", content: analysisPrompt },
      ],
      maxTokens: 300,
      model: ROUTER_MODEL_ID,
    });

    const elapsed = Date.now() - startTime;
    console.log(`[memory-analysis] Completed in ${elapsed}ms`);

    const content = text;
    if (!content) {
      console.error("[memory-analysis] No content in response");
      return null;
    }

    // Extract JSON from response
    let jsonText = content.trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonText);
    console.log("[memory-analysis] Parsed result:", parsed);

    if (!parsed.shouldWrite) {
      return null;
    }

    // Validate response
    const validTypes: MemoryType[] = [
      "preference", "identity", "constraint", "workflow", 
      "project", "instruction", "other"
    ];

    if (!validTypes.includes(parsed.type)) {
      console.error(`[memory-analysis] Invalid type: ${parsed.type}`);
      return null;
    }

    if (!parsed.title || !parsed.content) {
      console.error("[memory-analysis] Missing title or content");
      return null;
    }

    return {
      shouldWrite: true,
      type: parsed.type as MemoryType,
      title: parsed.title.substring(0, 60), // Truncate to 60 chars
      content: parsed.content,
      reasoning: parsed.reasoning,
    };
  } catch (error) {
    console.error("[memory-analysis] Error during analysis:", error);
    return null;
  }
}

/**
 * Returns usage data for memory analysis (for cost tracking)
 */
export function getMemoryAnalysisUsageEstimate() {
  // Rough estimate: ~200 input tokens, ~50 output tokens for Nano
  return {
    model: "google/gemma-3-4b-it",
    inputTokens: 200,
    outputTokens: 50,
  };
}
