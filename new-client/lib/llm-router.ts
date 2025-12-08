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

const ROUTER_MODEL_ID = "gpt-5-nano-2025-08-07";
const ROUTER_SYSTEM_PROMPT = `You are a lightweight routing assistant. Your primary job: choose the model and reasoning effort. Additionally, select which memory categories to load and any memory/permanent-instruction writes/deletes when warranted.

- Default to the smallest model that answers reliably; escalate only when clearly necessary (stakes, complexity, length).
- Valid models: gpt-5-nano, gpt-5-mini, gpt-5.1.
- Valid efforts: none|low|medium|high (none is only valid for gpt-5.1).
- For memoryTypesToLoad, pick only the minimal set of categories needed from the provided list.
- memory/permanent writes/deletes should be rare and only when the user clearly provides durable info or revokes it.
- Output JSON with keys: model, effort, routedBy, memoryTypesToLoad, memoriesToWrite, memoriesToDelete, permanentInstructionsToWrite, permanentInstructionsToDelete.`;

/**
 * Calls GPT 5 Nano to decide model and reasoning effort
 */
export async function routeWithLLM(
  promptText: string,
  context?: RouterContext
): Promise<LLMRouterDecision | null> {
  try {
    // Dynamic import to avoid build-time dependency
    const OpenAI = (await import("openai")).default;
    
    if (!process.env.OPENAI_API_KEY) {
      console.error("[llm-router] OPENAI_API_KEY not set");
      return null;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Build context message
    let contextNote = "";
    if (context?.userModelPreference && context.userModelPreference !== "auto") {
      contextNote += `\nIMPORTANT: User explicitly selected "${context.userModelPreference}" - you MUST recommend this model (only decide reasoning effort).`;
    }
    if (context?.speedMode === "instant") {
      contextNote += `\nUser selected INSTANT mode - prefer "none" (for 5.1) or "low" effort.`;
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

  const routerPrompt = `${contextNote ? `${contextNote}\n\n` : ""}Analyze this prompt and recommend model + effort. Also choose minimal memoryTypesToLoad and any memory/permanent write/delete actions if clearly warranted.${memoryTypeHint}\n\nPrompt:\n${promptText}`;

    console.log("[llm-router] Starting LLM routing call");
    const startTime = Date.now();

    const response = await openai.responses.create({
      model: ROUTER_MODEL_ID,
      input: [
        { role: "system", content: ROUTER_SYSTEM_PROMPT, type: "message" },
        { role: "user", content: routerPrompt, type: "message" },
      ],
      reasoning: { effort: "low" },
      text: {
        format: {
          type: "json_schema",
          name: "router_decision",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              model: { type: "string", enum: ["gpt-5-nano", "gpt-5-mini", "gpt-5.1"] },
              effort: { type: "string", enum: ["none", "low", "medium", "high"] },
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
            required: ["model", "effort", "routedBy", "memoryTypesToLoad"],
          },
        },
      },
    });

    const elapsed = Date.now() - startTime;
    console.log(`[llm-router] LLM routing completed in ${elapsed}ms`);

    const usageInfo = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (usageInfo) {
      lastRouterUsage = {
        model: ROUTER_MODEL_ID,
        inputTokens: usageInfo.input_tokens ?? lastRouterUsage.inputTokens,
        outputTokens: usageInfo.output_tokens ?? lastRouterUsage.outputTokens,
      };
    }

    const parsed = (() => {
      try {
        const outputs: any[] = Array.isArray((response as any).output)
          ? ((response as any).output as any[])
          : [];
        const maybeMessage = outputs.find((item) => item && item.type === "message") as
          | { content?: Array<{ text?: string }> }
          | undefined;
        const text =
          (maybeMessage?.content && maybeMessage.content[0]?.text) ||
          (response as any).output_text ||
          "";
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
      "gpt-5.1",
    ];
    const validEfforts: ReasoningEffort[] = ["none", "low", "medium", "high"];
    if (!validModels.includes(parsed.model)) {
      console.error(`[llm-router] Invalid model: ${parsed.model}`);
      return null;
    }

    if (!validEfforts.includes(parsed.effort)) {
      console.error(`[llm-router] Invalid effort: ${parsed.effort}`);
      return null;
    }

    // Block GPT 5 Pro
    if (parsed.model === "gpt-5-pro-2025-10-06") {
      console.warn("[llm-router] Router tried to select GPT 5 Pro, defaulting to 5.1");
      parsed.model = "gpt-5.1";
    }

    // Ensure Mini/Nano don't use "none" effort
    if ((parsed.model === "gpt-5-mini" || parsed.model === "gpt-5-nano") && parsed.effort === "none") {
      console.warn(`[llm-router] ${parsed.model} cannot use "none" effort, forcing to "low"`);
      parsed.effort = "low";
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
    const OpenAI = (await import("openai")).default;
    
    if (!process.env.OPENAI_API_KEY) {
      console.error("[memory-analysis] OPENAI_API_KEY not set");
      return null;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    const response = await openai.responses.create({
      model: "gpt-5-nano-2025-08-07",
      input: [
        { role: "system", content: MEMORY_ANALYSIS_PROMPT, type: "message" },
        { role: "user", content: analysisPrompt, type: "message" },
      ],
      reasoning: { effort: "low" },
    });

    const elapsed = Date.now() - startTime;
    console.log(`[memory-analysis] Completed in ${elapsed}ms`);

    const content = response.output_text;
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
    model: "gpt-5-nano-2025-08-07",
    inputTokens: 200,
    outputTokens: 50,
  };
}
