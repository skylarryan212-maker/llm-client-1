/**
 * LLM-based Router for Model Selection
 * 
 * Uses GPT 5 Nano to intelligently decide which model and reasoning effort
 * should be used for a given prompt, replacing hardcoded heuristics with
 * AI-powered decision making.
 */

import type { ModelFamily, ReasoningEffort } from "./modelConfig";
import type { MemoryType } from "./memory";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ContextStrategy = 
  | "minimal"      // Use cache only (new factual questions)
  | "recent"       // Load last 15 messages (normal conversation)
  | "full";        // Load all messages (enumeration/recall)

export type WebSearchStrategy =
  | "never"        // No search needed (greetings, meta questions, offline tasks)
  | "optional"     // Model can choose (might need fresh data)
  | "required";    // Must search (explicit requests, current events, prices)

export interface MemoryStrategy {
  types: string[] | "all";      // Which memory types to load
  useSemanticSearch: boolean;   // Whether to use vector search
  query?: string;               // Optimized query for semantic search
  limit: number;                // Max memories to load
}

export type NextTurnPrediction = "likely" | "unlikely" | "unknown";

export interface MemoryToWrite {
  type: string;      // Dynamic category name
  title: string;     // Brief title
  content: string;   // Memory content
}

export interface MemoryToDelete {
  id: string;        // Memory ID to delete
  reason: string;    // Why it should be deleted
}

export interface RouterContextLine {
  role: string;
  content: string;
}

const ROUTER_CONTEXT_MAX_LINES = 10;
const ROUTER_CONTEXT_TOKEN_CAP = 2000;

export interface RouterDecision {
  model: Exclude<ModelFamily, "auto">;
  effort: ReasoningEffort;
  contextStrategy: ContextStrategy;
  webSearchStrategy: WebSearchStrategy;
  memoryStrategy: MemoryStrategy;
  memoriesToWrite: MemoryToWrite[];  // Memories to save based on user's prompt
  memoriesToDelete: MemoryToDelete[];  // Memories to delete based on user's request
  nextTurnPrediction?: NextTurnPrediction;
  routedBy: "llm";
}

export function appendRouterContextLine(
  lines: RouterContextLine[] | undefined,
  role: string,
  rawContent: string
): RouterContextLine[] {
  const base = Array.isArray(lines) ? [...lines] : [];
  const truncated = truncateMessageForRouter(role, rawContent || "");
  const next = [...base, { role, content: truncated }];

  while (next.length > ROUTER_CONTEXT_MAX_LINES) {
    next.shift();
  }

  while (estimateLinesTokens(next) > ROUTER_CONTEXT_TOKEN_CAP && next.length > 1) {
    next.shift();
  }

  return next;
}

export function renderRouterContextText(lines: RouterContextLine[]): string {
  if (!Array.isArray(lines) || lines.length === 0) {
    return "";
  }
  return lines.map((line) => `${line.role}: ${line.content}`).join("\n");
}

export function ensureRouterContextLines(value: unknown): RouterContextLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const role = typeof (entry as any).role === "string" ? (entry as any).role : "";
      const content = typeof (entry as any).content === "string" ? (entry as any).content : "";
      if (!role || !content) return null;
      return { role, content };
    })
    .filter((entry): entry is RouterContextLine => Boolean(entry));
}

function estimateLinesTokens(lines: RouterContextLine[]): number {
  if (!Array.isArray(lines) || lines.length === 0) return 0;
  return lines.reduce((total, line) => total + estimateTokens(`${line.role}: ${line.content}`), 0);
}

export interface RouterContext {
  userModelPreference?: ModelFamily;
  speedMode?: "auto" | "instant" | "thinking";
  usagePercentage?: number;
  availableMemoryTypes?: string[];  // Dynamic memory categories user has created
}

const ROUTER_SYSTEM_PROMPT = `You are a routing assistant that analyzes user prompts and recommends the optimal AI model, reasoning effort, context strategy, and web search strategy.

**Reliability-first selection**
Evaluate how reliable the response must be. Default to the smallest model that can answer the prompt with high confidence. Only escalate when you can clearly explain what could go wrong if the smaller model handled it (e.g., high-stakes financial/legal advice, production code deploys, safety-critical instructions, or extremely long/nuanced tasks). In your reasoning, state the concrete risk that forced you to pick a larger model. If you cannot name a specific risk, choose a smaller model.

**Available Models:**
1. **gpt-5-nano** - Fastest, cheapest. Handles most everyday requests, multi-step reasoning, and concise code when stakes are low.
2. **gpt-5-mini** - Balanced. Use when you need extra reliability, longer outputs, or more nuanced reasoning that might exceed Nano's comfort zone.
3. **gpt-5.1** - Most capable. Reserve for very high stakes, extremely long-form tasks, or situations where failure would be costly.

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

**Memory Strategy:**
You will be provided with a list of available memory types (categories the user has created). Decide which to load based on the prompt:

**Memory Loading Rules:**
- Always scan the entire list of available memory types. If a category name (or any reasonable synonym) might relate to the prompt, include it with a limit (≥5). It is better to load a category and decide it's irrelevant than to skip it and miss important context.
- If the available memory types already include a category whose name or obvious synonym appears in the user's prompt, you MUST include that type in the list and load at least a small limit (>=5) so you can review it before answering.
- "What do you know about me?" → types: ["all"], useSemanticSearch: false, limit: 50 (load everything)
- "Tell me everything" → types: ["all"], useSemanticSearch: false, limit: 50
- Specific topic questions → types: [relevant categories], useSemanticSearch: true, query: "optimized search terms", limit: 15
- Questions referencing multiple topics → types: [relevant categories], useSemanticSearch: true, limit: 20
- "What is my name?", "who am I?", "what's my identity?" → types: ["identity"], useSemanticSearch: false, limit: 15 (load identity memories so you can answer)
- "Check your memory", "what memories do you have?", "what do you remember about ___?" → types: ["all"], useSemanticSearch: false, limit: 30 (load as much as possible so you can confirm or summarize)
- Greetings, unrelated questions → types: [], useSemanticSearch: false, limit: 0 (no memories needed)

**Examples:**
- "What's my workout routine?" with types: ["fitness", "health", "identity"] 
  → types: ["fitness"], useSemanticSearch: true, query: "workout exercise routine", limit: 10
  
- "Plan dinner based on my food preferences and diet" with types: ["food_preferences", "health", "fitness"]
  → types: ["food_preferences", "health"], useSemanticSearch: true, query: "food diet nutrition meals", limit: 15
  
- "What do you remember about me?" with types: ["identity", "work_context", "preferences"]
  → types: ["all"], useSemanticSearch: false, limit: 50
  
- "Hello" with types: ["identity", "preferences"]
  → types: ["identity"], useSemanticSearch: false, limit: 5 (just basic identity)

**Memory Writing Rules:**
CRITICAL: Analyze ONLY the user's current prompt for memory-worthy information. NEVER create memories based on assistant responses or conversation history shown below.

Decide if the user's prompt contains information that should be saved:
- Explicit requests: "remember that...", "save this...", "don't forget..."
- Personal information: name, location, preferences, constraints, goals
- Important context: work details, project info, relationships, habits
- When the instructions mention available memory types, treat those names as canonical categories. Reuse whichever one most closely matches the new fact. Only invent a new type when none of the existing names capture the topic, and avoid creating near-duplicate names (e.g., don't use both "romantic_interests" and "romance" for similar info).
- Never shoehorn an unrelated fact into an existing category just because it already exists. If only one category exists (e.g., "romantic_interests") and the new information is about work, hobbies, or anything unrelated, you MUST create a new descriptive category such as "work_context" or "hobbies".

**Memory Writing Examples:**
- "remember that I like steak" → [{"type": "food_preferences", "title": "Likes steak", "content": "User enjoys eating steak"}]
- "I prefer TypeScript over JavaScript" → [{"type": "programming_preferences", "title": "Prefers TypeScript", "content": "User prefers TypeScript over JavaScript"}]
- "my name is John" → [{"type": "identity", "title": "Name is John", "content": "User's name is John"}]
- "never use emojis when talking to me" → [{"type": "constraint", "title": "No emojis", "content": "User doesn't want emojis in responses"}]
- "I'm working on a chatbot project" → [{"type": "work_context", "title": "Chatbot project", "content": "User is working on a chatbot project"}]
- "I have a crush on a girl named Aya" → [{"type": "romantic_interests", "title": "Crush on Aya", "content": "User has a crush on a girl named Aya"}]
- "What's the weather?" → [] (no memory needed)
- "explain quantum mechanics" → [] (no personal info)
- "yes" or "ok" → [] (short response, no new info)

**Memory Deletion Rules:**
If the user explicitly asks to delete, forget, or remove a memory, identify which loaded memory matches their request and include it in memoriesToDelete.

**Memory Deletion Examples:**
- "forget that I like steak" + loaded memory: {id: "abc-123", title: "Likes steak", content: "User enjoys eating steak"} 
  → memoriesToDelete: [{"id": "abc-123", "reason": "User requested to forget food preference"}]
- "delete my workplace info" + loaded memory: {id: "xyz-789", title: "Works at ice rink", content: "User works at an ice skating rink"}
  → memoriesToDelete: [{"id": "xyz-789", "reason": "User requested to delete workplace information"}]
- "remove the memory about Aya" + loaded memory: {id: "def-456", title: "Crush on Aya", content: "User has a crush on Aya"}
  → memoriesToDelete: [{"id": "def-456", "reason": "User requested to remove romantic interest memory"}]

IMPORTANT: Only include memory IDs that are present in the loaded memories provided in the instructions. You cannot delete memories that weren't loaded.

**Next-turn prediction**
After you decide on the current response, predict whether the user will likely send another complex follow-up that needs fresh routing. Output:
- "likely" when wording implies more parts are coming, the user promises additional info, or the task clearly continues (e.g., "first draft", "I'll send more data", "keep going with several ideas").
- "unlikely" for closings, confirmations, gratitude, or when the prompt clearly ends the thread.
- "unknown" when intent is unclear.

**Dynamic Memory Types:**
Create ANY descriptive category name that makes sense! Examples: romantic_interests, fitness_goals, food_preferences, work_projects, travel_plans, hobbies, family_info, coding_style, meeting_schedule, health_conditions, etc.

**Response Format:**
Respond with ONLY a valid JSON object (no markdown, no explanation, no additional text):
{
  "model": "gpt-5-nano" | "gpt-5-mini" | "gpt-5.1",
  "effort": "none" | "low" | "medium" | "high",
  "contextStrategy": "minimal" | "recent" | "full",
  "webSearchStrategy": "never" | "optional" | "required",
  "memoryStrategy": {
    "types": ["type1", "type2"] | "all",
    "useSemanticSearch": boolean,
    "query": "optional search query",  // omit this field if not using semantic search
    "limit": number
  },
  "memoriesToWrite": [
    {"type": "category_name", "title": "brief title", "content": "memory content"}
  ],  // empty array if nothing to save
  "memoriesToDelete": [
    {"id": "memory-id", "reason": "why deleting"}
  ],  // empty array if nothing to delete
  "nextTurnPrediction": "likely" | "unlikely" | "unknown",
  "reasoning": "brief one-line explanation"
}

CRITICAL: Your entire response must be ONLY the JSON object. No other text before or after. For optional fields, omit them entirely rather than using null or undefined.`;

/**
 * Calls GPT 5 Nano to decide model and reasoning effort
 */
export async function routeWithLLM(
  promptText: string,
  conversationHistory: string,
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
    if (context?.availableMemoryTypes && context.availableMemoryTypes.length > 0) {
      contextNote += `\n\nAvailable memory types for this user: ${context.availableMemoryTypes.join(", ")}. Reuse whichever one best matches any new fact you want to store; only invent a new type name when none of these categories fit, and avoid creating near-duplicate names. If the user shares information that does not match the existing categories (e.g., only "romantic_interests" exists but they talk about their job), you MUST create a new descriptive type instead of forcing it into the existing one.`;
    } else {
      contextNote += `\n\nNo memory types available yet (user hasn't saved any memories).`;
    }

    // Add conversation history if available
    let historySection = "";
    if (conversationHistory) {
      historySection = `\n\n**Recent Conversation History:**\n${conversationHistory}\n\n**Current User Prompt (analyze THIS for memories):**\n`;
    }

    const routerPrompt = `${contextNote ? contextNote + "\n" : ""}${historySection}${historySection ? '' : 'Analyze this prompt and recommend model + effort + memory strategy:\n\n'}${promptText}`;

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

    const usageInfo = (response as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
    if (usageInfo) {
      lastRouterUsage = {
        model: "gpt-5-nano-2025-08-07",
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
    const validStrategies: ContextStrategy[] = ["minimal", "recent", "full"];
    const validWebSearch: WebSearchStrategy[] = ["never", "optional", "required"];
    const validPredictions: NextTurnPrediction[] = ["likely", "unlikely", "unknown"];

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

    // Validate and default memory strategy
    if (!parsed.memoryStrategy || typeof parsed.memoryStrategy !== 'object') {
      console.warn('[llm-router] Missing memoryStrategy, using default');
      parsed.memoryStrategy = { types: "all", useSemanticSearch: false, limit: 20 };
    } else {
      if (!parsed.memoryStrategy.types) {
        parsed.memoryStrategy.types = "all";
      }
      if (typeof parsed.memoryStrategy.useSemanticSearch !== 'boolean') {
        parsed.memoryStrategy.useSemanticSearch = false;
      }
      if (typeof parsed.memoryStrategy.limit !== 'number' || parsed.memoryStrategy.limit < 0) {
        parsed.memoryStrategy.limit = 20;
      }
    }

    // Validate and default memoriesToWrite
    if (!parsed.memoriesToWrite || !Array.isArray(parsed.memoriesToWrite)) {
      parsed.memoriesToWrite = [];
    } else {
      // Validate each memory has required fields
      parsed.memoriesToWrite = parsed.memoriesToWrite.filter((mem: any) => 
        mem && typeof mem === 'object' && mem.type && mem.title && mem.content
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

    if (!parsed.nextTurnPrediction || !validPredictions.includes(parsed.nextTurnPrediction)) {
      parsed.nextTurnPrediction = "unknown";
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
      memoryStrategy: parsed.memoryStrategy as MemoryStrategy,
      memoriesToWrite: parsed.memoriesToWrite as MemoryToWrite[],
      memoriesToDelete: parsed.memoriesToDelete as MemoryToDelete[],
      nextTurnPrediction: parsed.nextTurnPrediction as NextTurnPrediction,
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
  model: "gpt-5-nano-2025-08-07",
  inputTokens: 100,
  outputTokens: 20,
};

export function getRouterUsageEstimate() {
  return lastRouterUsage;
}

/**
 * Truncate a message intelligently for router context
 */
function truncateMessageForRouter(role: string, content: string): string {
  // Remove attachment content, just show marker
  const cleanContent = content.replace(/\[Attachment:.*?\]/g, '[File]');
  
  if (role === 'user') {
    // User: first 200 + last 100 chars
    if (cleanContent.length <= 300) return cleanContent;
    return cleanContent.slice(0, 200) + '...' + cleanContent.slice(-100);
  } else {
    // Assistant: first 150 chars
    if (cleanContent.length <= 150) return cleanContent;
    return cleanContent.slice(0, 150) + '...';
  }
}

/**
 * Rough token counter (4 chars ≈ 1 token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface RouterContextResult {
  text: string;
  lines: RouterContextLine[];
}

/**
 * Load conversation context for router with smart truncation.
 * Returns both the serialized text and the structured lines for caching.
 */
export async function getConversationContextForRouter(
  conversationId: string,
  supabase: SupabaseClient
): Promise<RouterContextResult> {
  const { data: messages, error } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error || !messages || messages.length === 0) {
    return { text: '', lines: [] };
  }
  
  // Reverse to chronological order
  messages.reverse();
  
  // Build truncated context with token cap
  const lines: RouterContextLine[] = [];
  for (const msg of messages) {
    lines.push({
      role: msg.role,
      content: truncateMessageForRouter(msg.role, msg.content),
    });
  }

  let trimmed = lines;
  while (estimateLinesTokens(trimmed) > ROUTER_CONTEXT_TOKEN_CAP && trimmed.length > 1) {
    trimmed = trimmed.slice(1);
  }

  return {
    text: renderRouterContextText(trimmed),
    lines: trimmed,
  };
}

export async function persistRouterContextCache(
  supabase: SupabaseClient,
  conversationId: string,
  lines: RouterContextLine[],
  lastMessageId: string | null
) {
  try {
    await supabase
      .from("conversations")
      .update({
        router_context_cache: lines,
        router_context_cache_last_message_id: lastMessageId,
        router_context_cache_updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId);
  } catch (error) {
    console.warn("[llm-router] Failed to persist router context cache:", error);
  }
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
