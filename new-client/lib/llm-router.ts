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
  memoriesToWrite: MemoryToWrite[];  // Memories to save based on user's prompt
  memoriesToDelete: MemoryToDelete[];  // Memories to delete based on user's request
  permanentInstructionsToWrite: PermanentInstructionToWrite[];
  permanentInstructionsToDelete: PermanentInstructionToDelete[];
  routedBy: "llm";
}

export interface RouterContext {
  userModelPreference?: ModelFamily;
  speedMode?: "auto" | "instant" | "thinking";
  usagePercentage?: number;
  availableMemoryTypes?: string[];  // Dynamic memory categories user has created
  permanentInstructionSummary?: string;
  permanentInstructions?: PermanentInstructionToWrite[]; // Full list with IDs/content/scope
}

const ROUTER_MODEL_ID = "gpt-5-nano-2025-08-07";
const ROUTER_SYSTEM_PROMPT = `You are a routing assistant that analyzes user prompts and recommends the optimal AI model and reasoning effort.

  **Reliability-first selection**
  Evaluate how reliable the response must be. Default to the smallest model that can answer the prompt with high confidence. Only escalate when you can clearly explain what could go wrong if the smaller model handled it (e.g., high-stakes financial/legal advice, production code deploys, safety-critical instructions, or extremely long/nuanced tasks). State the concrete risk that forced you to pick a larger model. If you cannot name a specific risk, choose a smaller model.

  **Available Models:**
  1. **gpt-5-nano** - Fastest, cheapest, handles everyday requests, multi-step reasoning, and concise code when stakes are low.
  2. **gpt-5-mini** - Balanced; use when you need extra reliability or nuance beyond Nano's comfort zone.
  3. **gpt-5.1** - Most capable; reserve for very high stakes, long-form, or correctness-sensitive tasks.

  **Reasoning Effort Levels:**
  - **none**: Instant responses (GPT-5.1 only)
  - **low**: Minimal reasoning
  - **medium**: Moderate reasoning
  - **high**: Deep reasoning for complex problems

  **Routing Guidelines:**
  - Short greetings -> nano + low
  - Simple factual questions -> nano or mini + low
  - Clarifications/references -> mini + low
  - Summaries, explanations, analysis -> mini + low/medium
  - Long or complex prompts -> gpt-5.1 + medium/high
  - Creative writing or multi-section output -> gpt-5.1 + medium/high

  Keep your instructions focused on selecting the model and reasoning effort; do not mention web search or memory strategy in this prompt.

  **Structured output requirement**
  Every response must be valid JSON that matches the LLMRouterDecision schema (model, effort, memoriesToWrite, memoriesToDelete, permanentInstructionsToWrite, permanentInstructionsToDelete, routedBy). Do not emit prose or explanations—return only the JSON payload so downstream code can parse it reliably.

  **Memory shape (STRICT)**
  - Each memory object MUST include: `type`, `title`, and `content`.
  - NEVER use a `value` field. If you would have used `value`, instead set `content` and also provide a short `title`.
  - Example:
    "memoriesToWrite": [
      {
        "type": "identity",
        "title": "User's name is Skylar",
        "content": "User's name is Skylar; address them as Skylar."
      }
    ]
`;

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
    if (context?.availableMemoryTypes && context.availableMemoryTypes.length > 0) {
      contextNote += `\n\nAvailable memory types for this user: ${context.availableMemoryTypes.join(", ")}. Reuse whichever one best matches any new fact you want to store; only invent a new type name when none of these categories fit, and avoid creating near-duplicate names. If the user shares information that does not match the existing categories (e.g., only "romantic_interests" exists but they talk about their job), you MUST create a new descriptive type instead of forcing it into the existing one.`;
    } else {
      contextNote += `\n\nNo memory types available yet (user hasn't saved any memories).`;
    }
    if (context?.permanentInstructionSummary) {
      contextNote += `\n\n${context.permanentInstructionSummary}`;
    }
    if (context?.permanentInstructions && context.permanentInstructions.length > 0) {
      const lines = context.permanentInstructions
        .map((inst) => {
          const scope = inst.scope ?? "user";
          const title = inst.title ? `${inst.title}: ` : "";
          const content = inst.content || "";
          const id = (inst as any).id ? ` [${(inst as any).id}]` : "";
          return `- (${scope}${id}) ${title}${content}`;
        })
        .join("\n");
      contextNote += `\n\nPermanent instructions with IDs (use these IDs if you need to delete one):\n${lines}`;
    }

    const routerPrompt = `${contextNote ? `${contextNote}\n\n` : ""}Analyze this prompt and recommend model + effort + memory strategy:\n\n${promptText}`;

    console.log("[llm-router] Starting LLM routing call");
    const startTime = Date.now();

    const response = await openai.responses.create({
      model: ROUTER_MODEL_ID,
      input: [
        { role: "system", content: ROUTER_SYSTEM_PROMPT, type: "message" },
        { role: "user", content: routerPrompt, type: "message" },
      ],
      reasoning: { effort: "low" },
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

    const content = response.output_text;
    if (!content) {
      console.error("[llm-router] No content in response");
      return null;
    }

    // Extract JSON from response (handle potential markdown wrapping)
    let jsonText = content.trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonText);
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

    // Validate and default memoriesToWrite
    if (!parsed.memoriesToWrite || !Array.isArray(parsed.memoriesToWrite)) {
      parsed.memoriesToWrite = [];
    } else {
      // Normalize legacy shapes (e.g., { type, value }) before validation
      parsed.memoriesToWrite = parsed.memoriesToWrite
        .map((mem: any) => {
          if (!mem || typeof mem !== "object") return mem;
          // Promote "value" to content if present
          if (!mem.content && typeof mem.value === "string") {
            mem.content = mem.value;
          }
          // Synthesize a title from content if missing
          if (!mem.title && typeof mem.content === "string") {
            mem.title = mem.content.slice(0, 80);
          }
          return mem;
        })
        .filter(
          (mem: any) => mem && typeof mem === "object" && mem.type && mem.title && mem.content
        );
    }

    // Validate and default memoriesToDelete
    if (!parsed.memoriesToDelete || !Array.isArray(parsed.memoriesToDelete)) {
      parsed.memoriesToDelete = [];
    } else {
      // Validate each deletion has required fields
      parsed.memoriesToDelete = parsed.memoriesToDelete.filter((mem: any) => 
        mem && typeof mem === 'object' && mem.id && mem.reason
      );
    }

    if (!parsed.permanentInstructionsToWrite || !Array.isArray(parsed.permanentInstructionsToWrite)) {
      parsed.permanentInstructionsToWrite = [];
    } else {
      parsed.permanentInstructionsToWrite = parsed.permanentInstructionsToWrite.filter(
        (inst: any) =>
          inst &&
          typeof inst === "object" &&
          typeof inst.content === "string" &&
          inst.content.trim().length > 0
      );
    }

    if (!parsed.permanentInstructionsToDelete || !Array.isArray(parsed.permanentInstructionsToDelete)) {
      parsed.permanentInstructionsToDelete = [];
    } else {
      parsed.permanentInstructionsToDelete = parsed.permanentInstructionsToDelete.filter(
        (inst: any) => inst && typeof inst === "object" && typeof inst.id === "string" && inst.id.trim().length > 0
      );
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
      memoriesToWrite: parsed.memoriesToWrite as MemoryToWrite[],
      memoriesToDelete: parsed.memoriesToDelete as MemoryToDelete[],
      permanentInstructionsToWrite: parsed.permanentInstructionsToWrite as PermanentInstructionToWrite[],
      permanentInstructionsToDelete: parsed.permanentInstructionsToDelete as PermanentInstructionToDelete[],
      routedBy: "llm",
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
