/**
 * LLM-based Router for Model Selection
 * 
 * Uses GPT 5 Nano to intelligently decide which model and reasoning effort
 * should be used for a given prompt, replacing hardcoded heuristics with
 * AI-powered decision making.
 */

import type { ModelFamily, ReasoningEffort } from "./modelConfig";

export type ContextStrategy = 
  | "minimal"      // Use cache only (new factual questions)
  | "recent"       // Load last 15 messages (normal conversation)
  | "full";        // Load all messages (enumeration/recall)

export type WebSearchStrategy =
  | "never"        // No search needed (greetings, meta questions, offline tasks)
  | "optional"     // Model can choose (might need fresh data)
  | "required";    // Must search (explicit requests, current events, prices)

export interface RouterDecision {
  model: Exclude<ModelFamily, "auto">;
  effort: ReasoningEffort;
  contextStrategy: ContextStrategy;
  webSearchStrategy: WebSearchStrategy;
  routedBy: "llm";
}

export interface RouterContext {
  userModelPreference?: ModelFamily;
  speedMode?: "auto" | "instant" | "thinking";
  usagePercentage?: number;
}

const ROUTER_SYSTEM_PROMPT = `You are a routing assistant that analyzes user prompts and recommends the optimal AI model, reasoning effort, context strategy, and web search strategy.

**Available Models:**
1. **gpt-5-nano** - Fastest, cheapest. For simple queries, greetings, basic Q&A.
2. **gpt-5-mini** - Balanced. For moderate complexity, explanations, summaries.
3. **gpt-5.1** - Most capable. For complex reasoning, long-form content, technical tasks.

⚠️ NEVER recommend "gpt-5-pro-2025-10-06" - it is not available for routing.

**Reasoning Effort Levels:**
- **none**: No extended reasoning (GPT 5.1 only, for instant responses)
- **low**: Minimal reasoning (quick thinking)
- **medium**: Moderate reasoning (balanced)
- **high**: Deep reasoning (complex problems)

Note: gpt-5-mini and gpt-5-nano MUST use "low", "medium", or "high" (never "none").

**Context Strategy:**
- **minimal**: Use cached context only, don't load message history (ONLY for completely standalone questions with no conversational signals)
- **recent**: Load last 15 messages (for ANY conversational continuations, clarifications, corrections, follow-ups, or references)
- **full**: Load ALL messages from database (for enumeration, listing, recalling old messages)

**Context Strategy Examples:**
- "What's the weather in Paris?" → minimal (ONLY if first message or topic change)
- "Explain quantum mechanics" → minimal (ONLY if standalone, not part of conversation)
- "no", "yes", "ok", "no thats ok" → recent (conversational responses)
- "its X specifically", "I meant Y" → recent (clarifications/corrections)
- "im talking about X", "I have X, so..." → recent (references previous context)
- "Can you explain that better?" → recent (refers to recent context)
- "tell me more", "what about..." → recent (follow-ups)
- "Continue from where we left off" → recent (conversation flow)
- "What were all my prompts?" → full (needs to enumerate messages)
- "List everything we discussed" → full (needs full history)
- "What was my first question?" → full (needs oldest message)
- "Summarize our conversation" → full (needs all messages)

⚠️ **CRITICAL**: If message is short (<20 words) and continues/responds to previous context, ALWAYS use "recent". Better to load extra context than hallucinate.

**Web Search Strategy (NEW - IMPORTANT):**
- **never**: No search needed (greetings, offline math/logic, meta questions about AI, explanations of known concepts)
- **optional**: Model can decide to search (questions that might need fresh data, ambiguous cases)
- **required**: Must use web search (explicit search requests, current events, live data, prices, weather, recent news)

**Web Search Examples:**
- "Hi" / "Hello" → never (greeting)
- "What's 2+2?" → never (math, no search needed)
- "Explain quantum mechanics" → never (timeless concept)
- "Can you search the web?" → never (meta question about capabilities)
- "Who won the game last night?" → required (recent event)
- "What's the weather today?" → required (live data)
- "Current price of Bitcoin" → required (real-time data)
- "Search the web for..." → required (explicit request)
- "Latest news about AI" → required (current events)
- "When does the sun set?" → optional (could calculate or search for exact time)
- "Best restaurants in NYC" → optional (could use knowledge or search for current)
- "What happened in 2024?" → optional (recent past, search might help)

**Routing Guidelines:**
- Short greetings ("hi", "hello") → nano + low + minimal + never (ONLY if first message)
- Simple factual questions → nano or mini + low + minimal + never (ONLY if standalone, no context needed)
- Short conversational responses ("no", "yes", "ok") → nano + low + recent + never
- Clarifications/corrections ("its X specifically", "I meant Y") → mini + low + recent + never
- References to prior context ("I have X, so...", "im talking about X") → mini + low + recent + never
- Follow-up questions ("explain that", "tell me more", "what about...") → mini + low + recent + never
- Explanations, summaries, analysis → mini + low or medium + recent + never
- Current events, news, prices → mini + low + minimal + required (if standalone) OR recent + required (if follow-up)
- Weather, live data → nano or mini + low + minimal + required (if standalone) OR recent + required (if follow-up)
- Explicit search requests → mini + low + recent + required (usually references prior context)
- Long prompts (600+ words) → mini or 5.1 + medium + recent + never/optional
- Complex technical, coding, research → 5.1 + medium or high + recent + optional
- Enumeration/recall requests → mini or 5.1 + low + full + never
- Very long prompts (1000+ words) → 5.1 + high + recent + never/optional
- Creative writing, deep analysis → 5.1 + medium or high + recent + never

**Response Format:**
Respond with ONLY a valid JSON object (no markdown, no explanation, no additional text):
{
  "model": "gpt-5-nano" | "gpt-5-mini" | "gpt-5.1",
  "effort": "none" | "low" | "medium" | "high",
  "contextStrategy": "minimal" | "recent" | "full",
  "webSearchStrategy": "never" | "optional" | "required",
  "reasoning": "brief one-line explanation"
}

CRITICAL: Your entire response must be ONLY the JSON object. No other text before or after.`;

/**
 * Calls GPT 5 Nano to decide model and reasoning effort
 */
export async function routeWithLLM(
  promptText: string,
  context?: RouterContext
): Promise<RouterDecision | null> {
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

    const routerPrompt = `${contextNote ? contextNote + "\n\n" : ""}Analyze this prompt and recommend model + effort:\n\n${promptText}`;

    console.log("[llm-router] Starting LLM routing call");
    const startTime = Date.now();

    const response = await openai.responses.create({
      model: "gpt-5-nano-2025-08-07",
      input: [
        { role: "system", content: ROUTER_SYSTEM_PROMPT, type: "message" },
        { role: "user", content: routerPrompt, type: "message" },
      ],
      reasoning: { effort: "low" },
    });

    const elapsed = Date.now() - startTime;
    console.log(`[llm-router] LLM routing completed in ${elapsed}ms`);

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
    const validStrategies: ContextStrategy[] = ["minimal", "recent", "full"];
    const validWebSearch: WebSearchStrategy[] = ["never", "optional", "required"];

    if (!validModels.includes(parsed.model)) {
      console.error(`[llm-router] Invalid model: ${parsed.model}`);
      return null;
    }

    if (!validEfforts.includes(parsed.effort)) {
      console.error(`[llm-router] Invalid effort: ${parsed.effort}`);
      return null;
    }

    // Default to "recent" if contextStrategy is missing or invalid
    if (!parsed.contextStrategy || !validStrategies.includes(parsed.contextStrategy)) {
      console.warn(`[llm-router] Invalid or missing contextStrategy: ${parsed.contextStrategy}, defaulting to "recent"`);
      parsed.contextStrategy = "recent";
    }

    // Default to "optional" if webSearchStrategy is missing or invalid
    if (!parsed.webSearchStrategy || !validWebSearch.includes(parsed.webSearchStrategy)) {
      console.warn(`[llm-router] Invalid or missing webSearchStrategy: ${parsed.webSearchStrategy}, defaulting to "optional"`);
      parsed.webSearchStrategy = "optional";
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
      contextStrategy: parsed.contextStrategy as ContextStrategy,
      webSearchStrategy: parsed.webSearchStrategy as WebSearchStrategy,
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
export function getRouterUsageEstimate() {
  // Rough estimate: ~100 input tokens, ~20 output tokens for Nano
  return {
    model: "gpt-5-nano-2025-08-07",
    inputTokens: 100,
    outputTokens: 20,
  };
}
