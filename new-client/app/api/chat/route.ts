export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import { getModelAndReasoningConfigWithLLM } from "@/lib/modelConfig";
import type {
  ModelFamily,
  ReasoningEffort,
  SpeedMode,
} from "@/lib/modelConfig";
import { normalizeModelFamily, normalizeSpeedMode } from "@/lib/modelConfig";
import type { Database } from "@/lib/supabase/types";
import type { AssistantMessageMetadata } from "@/lib/chatTypes";
import {
  buildAssistantMetadataPayload,
  extractDomainFromUrl,
  formatSearchSiteLabel,
} from "@/lib/metadata";
import { dispatchExtract } from "@/lib/extraction/dispatcher";
import type {
  Tool,
  ToolChoiceOptions,
} from "openai/resources/responses/responses";
import { calculateCost, calculateVectorStorageCost } from "@/lib/pricing";
import { getUserPlan } from "@/app/actions/plan-actions";
import { getMonthlySpending } from "@/app/actions/usage-actions";
import { hasExceededLimit, getPlanLimit } from "@/lib/usage-limits";
import { getRelevantMemories, type PersonalizationMemorySettings, type MemoryStrategy } from "@/lib/memory-router";
import type { MemoryItem } from "@/lib/memory";
import { writeMemory, deleteMemory } from "@/lib/memory";
import {
  applyPermanentInstructionMutations,
  loadPermanentInstructions,
  type PermanentInstructionCacheItem,
} from "@/lib/permanentInstructions";
import { decideRoutingForMessage } from "@/lib/router/decideRoutingForMessage";
import type { RouterDecision } from "@/lib/router/types";
import { buildContextForMainModel } from "@/lib/context/buildContextForMainModel";
import { maybeExtractArtifactsFromMessage } from "@/lib/artifacts/maybeExtractArtifactsFromMessage";
import type { PermanentInstructionToWrite } from "@/lib/llm-router";
import { updateTopicSnapshot } from "@/lib/topics/updateTopicSnapshot";
import { refreshTopicMetadata } from "@/lib/topics/refreshTopicMetadata";

// Utility: convert a data URL (base64) to a Buffer
function dataUrlToBuffer(dataUrl: string): Buffer {
  // Expected format: data:<mime>;base64,<data>
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid data URL: no comma separator");
  }
  const base64 = dataUrl.slice(commaIndex + 1);
  return Buffer.from(base64, "base64");
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MEMORY_TYPE_KEYWORDS: Record<string, string[]> = {
  identity: ["my name", "who am", "call me", "what's my identity"],
  food_preferences: ["favorite food", "meal", "diet", "cuisine", "restaurant"],
  romantic_interests: ["crush", "girlfriend", "boyfriend", "romantic", "date"],
  work_context: ["work", "job", "project", "company", "boss", "coworker", "client"],
  hobbies: ["hobby", "hobbies", "free time", "weekend", "collecting"],
};

function normalizeTypeName(type: string) {
  return type.replace(/[_-]/g, " ").toLowerCase();
}

function detectRelevantMemoryTypes(prompt: string, availableTypes: string[]): string[] {
  const normalizedPrompt = prompt.toLowerCase();
  const matches = new Set<string>();

  for (const type of availableTypes) {
    const normalizedType = normalizeTypeName(type);
    if (normalizedType && normalizedPrompt.includes(normalizedType)) {
      matches.add(type);
      continue;
    }
    const canonical = type.toLowerCase();
    const synonyms = MEMORY_TYPE_KEYWORDS[canonical];
    if (
      synonyms &&
      synonyms.some((phrase) => phrase && normalizedPrompt.includes(phrase.toLowerCase()))
    ) {
      matches.add(type);
    }
  }
  return Array.from(matches);
}

function augmentMemoryStrategyWithHeuristics(
  strategy: MemoryStrategy,
  prompt: string,
  availableTypes: string[]
): { strategy: MemoryStrategy; addedTypes: string[] } {
  if (!availableTypes.length) {
    return { strategy, addedTypes: [] };
  }
  if (strategy.types === "all") {
    return { strategy, addedTypes: [] };
  }

  const currentTypes = Array.isArray(strategy.types) ? [...strategy.types] : strategy.types ? [strategy.types] : [];
  const matchedTypes = detectRelevantMemoryTypes(prompt, availableTypes);
  const additionalTypes = matchedTypes.filter((t) => !currentTypes.includes(t));

  if (additionalTypes.length === 0) {
    return { strategy, addedTypes: [] };
  }

  const updatedTypes = currentTypes.concat(additionalTypes);
  const updatedLimit = Math.max(strategy.limit || 0, Math.min(50, updatedTypes.length * 5));

  return {
    strategy: {
      ...strategy,
      types: updatedTypes,
      limit: updatedLimit,
    },
    addedTypes: additionalTypes,
  };
}

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type OpenAIClient = any;

let cachedOpenAIConstructor: { new (...args: any[]): OpenAIClient } | null = null;
async function getOpenAIConstructor(): Promise<{ new (...args: any[]): OpenAIClient }> {
  if (cachedOpenAIConstructor) {
    return cachedOpenAIConstructor;
  }
  const mod: any = await import("openai");
  const ctor = mod.default || mod.OpenAI || mod;
  cachedOpenAIConstructor = ctor;
  return ctor;
}

interface ChatRequestBody {
  conversationId: string;
  projectId?: string;
  message: string;
  modelFamilyOverride?: ModelFamily;
  speedModeOverride?: SpeedMode;
  reasoningEffortOverride?: ReasoningEffort;
  forceWebSearch?: boolean;
  skipUserInsert?: boolean;
  attachments?: Array<{ name?: string; mime?: string; dataUrl: string }>;
  location?: { lat: number; lng: number; city: string };
}

type SearchStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string }
  | { type: "file-search-start"; query: string }
  | { type: "file-search-complete"; query: string }
  | { type: "file-reading-start" }
  | { type: "file-reading-complete" }
  | { type: "file-reading-error"; message?: string };

const BASE_SYSTEM_PROMPT =
  "**CRITICAL RESPONSE RULE: You MUST ALWAYS provide a text response to the user. NEVER end a turn with only tool calls. Even if you call a function, you must follow it with explanatory text.**\\n\\n" +
  "You are a web-connected assistant with access to multiple tools for enhanced capabilities:\\n" +
  "- `web_search`: Live internet search for current events, weather, news, prices, etc.\\n" +
  "- `file_search`: Semantic search through uploaded documents\\n\\n" +
  "**Memory Behavior:**\\n" +
  "- User memories are preloaded in the 'Saved Memories' section below\\n" +
  "- When asked 'what do you know about me', respond based on the memories listed in your instructions\\n" +
  "- Do NOT say you need to search or list memories - just use what's already provided\\n" +
  "- Memories are automatically saved based on what users tell you - no manual saving needed\\n\\n" +
  "**Web Search Rules:**\\n" +
  "- Use internal knowledge for timeless concepts, math, or historical context.\\n" +
  "- For questions about current events, market conditions, weather, schedules, releases, or other fast-changing facts, prefer calling `web_search` to gather fresh data.\\n" +
  "- CRITICAL CITATION RULES: When `web_search` returns results, you MUST cite sources properly:\\n" +
  "  * ALWAYS use inline markdown links: [domain.com](https://full-url.com)\\n" +
  "  * NEVER cite without embedding the actual URL in markdown format\\n" +
  "  * NEVER write bare domains like '(Source: example.com)' without making them clickable links\\n" +
  "  * Example correct: 'According to [Wikipedia](https://en.wikipedia.org/wiki/Example), ...'\\n" +
  "  * Example wrong: 'According to Wikipedia, ...' or 'Source: wikipedia.org'\\n" +
  "  * At the end of your response, include a 'Sources:' section with numbered list of all cited links\\n" +
  "- Never claim you lack internet access or that your knowledge is outdated in a turn where tool outputs were provided.\\n" +
  "- If the tool returns little or no information, acknowledge that gap before relying on older knowledge.\\n" +
  "- Do not send capability or identity questions to `web_search`; answer those directly.\\n\\n" +
  "**General Rules:**\\n" +
  "- Keep answers clear and grounded, blending background context with any live data you retrieved.\\n" +
  "- When the user provides attachment URLs (marked as 'Attachment: name -> url'), fetch and read those documents directly from the URL without asking the user to re-upload. Use their contents in your reasoning and summarize as requested.\\n" +
  "- If an attachment preview is marked as '[Preview truncated; full content searchable via file_search tool]', you can use the `file_search` tool to query specific information from the full document (e.g., 'find pricing section', 'extract all dates', 'summarize chapter 3').\\n" +
  "- If an attachment is an image, extract any visible text (OCR) and use it in your reasoning along with a description if helpful.\\n" +
  "- IMPORTANT: When a user asks to 'list my prompts' or 'show my messages', only list the TEXT they typed. Do NOT list file contents, document excerpts, or attachment names as if they were prompts. The marker '[Files attached]' indicates files were included but is not part of the prompt.";

function loadPersonalizationSettings(): PersonalizationMemorySettings & { customInstructions?: string; baseStyle?: string } {
  try {
    if (typeof window === "undefined") {
      // Server-side: no localStorage access, return defaults
      return { referenceSavedMemories: true, allowSavingMemory: true };
    }
    const raw = window.localStorage.getItem("personalization.memory.v1");
    if (!raw) return { referenceSavedMemories: true, allowSavingMemory: true };
    const parsed = JSON.parse(raw);
    return {
      referenceSavedMemories: parsed.referenceSavedMemories ?? true,
      allowSavingMemory: parsed.allowSavingMemory ?? true,
      customInstructions: parsed.customInstructions || "",
      baseStyle: parsed.baseStyle || "Professional",
    };
  } catch {
    return { referenceSavedMemories: true, allowSavingMemory: true };
  }
}

function buildPermanentInstructionSummaryForRouter(
  instructions: PermanentInstructionCacheItem[],
  limit = 10
): string {
  if (!instructions.length) {
    return "No permanent instructions are saved for this user yet.";
  }
  const lines = instructions.slice(0, limit).map((inst) => {
    const summaryContent = inst.content.replace(/\s+/g, " ").trim();
    const titleText = inst.title ? inst.title.replace(/\s+/g, " ").trim() : null;
    const label = titleText ? `${titleText} – ${summaryContent}` : summaryContent;
    const scopeLabel = inst.scope === "conversation" ? "conversation" : "user";
    return `- [${inst.id} | ${scopeLabel}] ${label}`;
  });
  const extraCount = Math.max(instructions.length - limit, 0);
  const suffix = extraCount > 0 ? `\n- ...and ${extraCount} more.` : "";
  return `Current permanent instructions (use IDs if you need to delete one):\n${lines.join("\n")}${suffix}`;
}

function buildSystemPromptWithPersonalization(
  basePrompt: string,
  settings: { customInstructions?: string; baseStyle?: string },
  memories: MemoryItem[],
  permanentInstructions: PermanentInstructionCacheItem[] = []
): string {
  let prompt = basePrompt;

  // Add base style instruction
  if (settings.baseStyle) {
    const styleMap: Record<string, string> = {
      Professional: "Maintain a professional, formal tone in your responses.",
      Friendly: "Be warm, conversational, and friendly in your responses.",
      Concise: "Keep your responses brief and to the point, avoiding unnecessary elaboration.",
      Creative: "Be imaginative, expressive, and engaging in your responses.",
    };
    const styleInstruction = styleMap[settings.baseStyle];
    if (styleInstruction) {
      prompt += "\\n\\n" + styleInstruction;
    }
  }

  // Add custom instructions
  if (settings.customInstructions && settings.customInstructions.trim()) {
    prompt += "\\n\\n**Custom Instructions:**\\n" + settings.customInstructions.trim();
  }

  if (permanentInstructions.length > 0) {
    prompt += "\\n\\n**Permanent Instructions (ALWAYS follow these):**";
    for (const inst of permanentInstructions) {
      const scopeLabel = inst.scope === "conversation" ? " (this conversation)" : "";
      const lineTitle = inst.title ? `${inst.title}: ` : "";
      prompt += `\\n- ${lineTitle}${inst.content}${scopeLabel}`;
    }
  }

  // Add memories
  if (memories.length > 0) {
    prompt += "\\n\\n**Saved Memories (User Context):**";
    for (const mem of memories) {
      prompt += `\\n- [${mem.type}] ${mem.title}: ${mem.content} (id: ${mem.id})`;
    }
    prompt += "\\n\\nUse these memories to personalize your responses and maintain context about the user's preferences and information.";
  }

  return prompt;
}

const FORCE_WEB_SEARCH_PROMPT =
  "The user explicitly requested live web search. Ensure you call the `web_search` tool for this turn unless it would clearly be redundant.";

const EXPLICIT_WEB_SEARCH_PROMPT =
  "The user asked for live sources or links. You must call the `web_search` tool, base your answer on those results, and cite them using markdown links [text](url). Do not fabricate sources.";

// ============================================================================
// OLD WEB SEARCH HEURISTICS (DEPRECATED - NOW USING LLM ROUTER)
// ============================================================================
// The following patterns and functions were replaced by the LLM router's
// webSearchStrategy decision. Keeping them commented for reference but they
// are no longer actively used in the routing logic.
// ============================================================================

/*
const LIVE_DATA_HINTS = [
  "current",
  "today",
  "tonight",
  "latest",
  "recent",
        {
          type: "function",
          name: "save_memory",
          description:
            "Save important information about the user for future conversations.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              content: {
                description:
                  "The content to remember. Keep it concise and factual.",
                type: "string",
              },
              type: {
                description:
                  "The memory category. Choose the most specific applicable type.",
                type: "string",
                enum: [
                  "preference",
                  "profile",
                  "project",
                  "context",
                  "other",
                ],
              },
              enabled: {
                description:
                  "Whether this memory should be active by default.",
                type: "boolean",
              },
            },
            required: ["content", "type"],
          },
          strict: true,
        },
  "announced",
  "available",
  "availability",
  "in stock",
  "stock",
  "price",
  "prices",
  "cost",
  "ticket",
        {
          type: "function",
          name: "search_memories",
          description:
            "Search through saved user memories using semantic vector search.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: {
                description:
                  "The search query (what you are looking for).",
                type: "string",
              },
              type: {
                description:
                  "Filter by memory type; use 'all' to search everything.",
                type: "string",
                enum: ["preference", "profile", "project", "context", "other", "all"],
              },
              limit: {
                description: "Maximum number of results to return (default 5).",
                type: "integer",
                minimum: 1,
                maximum: 50,
              },
            },
            required: ["query"],
          },
          strict: true,
        },
  /olympics/i,
];

const PRODUCT_STYLE_PATTERN = /\b(?:[A-Z]{2,}[A-Za-z0-9+\-]*\d{2,5}|[A-Za-z]+\s?\d{4})\b/;

const MUST_WEB_SEARCH_PATTERNS = [
  /\bsearch (?:the )?(?:web|internet)\b/i,
  /\bsearch online\b/i,
  /\bweb search\b/i,
  /\blook (?:this|that|it)? up\b/i,
  /\bfind (?:links?|online|on the web)\b/i,
  /\bcheck (?:the )?(?:internet|web)\b/i,
  /\bbrowse the web\b/i,
  /\bgoogle (?:it|this)?\b/i,
  /\bcheck (?:current )?pricing\b/i,
  /\bcurrent price\b/i,
  /\bwhere to buy\b/i,
  /\bfind where to buy\b/i,
  /\bfind retailers?\b/i,
  /\bneed sources\b/i,
  /\bgive me (?:sources|citations)\b/i,
  /\bprovide (?:links?|sources|citations)\b/i,
  /\bshow (?:me )?(?:links?|sources)\b/i,
];

const SOURCE_REQUEST_PATTERNS = [
  /\binclude (?:the )?sources\b/i,
  /\bshare sources\b/i,
  /\bcite (?:your )?sources\b/i,
  /\bgive me references\b/i,
  /\bneed citations?\b/i,
];

const META_QUESTION_PATTERNS = [
  /\b(?:can|could|would) you (?:browse|access|use) (?:the )?(?:internet|web)/i,
  /\b(?:do|can) you have internet/i,
  /\bwhat(?:'s| is) your knowledge cutoff/i,
  /\bwhen were you (?:trained|last updated)/i,
  /\bare you able to search/i,
  /\bwhat model are you/i,
  /\bhow do your tools work/i,
];

function resolveWebSearchPreference({
  userText,
  forceWebSearch,
}: {
  userText: string;
  forceWebSearch: boolean;
}) {
  if (forceWebSearch) {
    return { allow: true, require: true };
  }
  const trimmed = userText.trim();
  if (!trimmed) {
    return { allow: false, require: false };
  }

  // Very short greetings or obvious offline tasks shouldn't trigger search
  if (/^(hi|hello|hey|thanks|thank you|ok|sure)[!. ]*$/i.test(trimmed)) {
    return { allow: false, require: false };
  }

  const lower = trimmed.toLowerCase();

  // If the user is explicitly asking meta questions ("who are you?"), skip search
  if (META_QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allow: false, require: false };
  }

  // Strong signals that we must search
  if (MUST_WEB_SEARCH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allow: true, require: true };
  }
  if (SOURCE_REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allow: true, require: true };
  }
  if (referencesEmergingEntity(trimmed)) {
    return { allow: true, require: true };
  }

  // Weather-specific: if user mentions weather/forecast/temperature, require live search
  // Especially for time-anchored asks like today/tonight/tomorrow/this week
  const isWeatherQuery = /\b(weather|temperature|forecast)\b/i.test(trimmed);
  const hasTimeAnchor = /\b(today|tonight|tomorrow|this (?:week|weekend|month|year))\b/i.test(trimmed);
  if (isWeatherQuery && (hasTimeAnchor || true)) {
    return { allow: true, require: true };
  }

  // Heuristics for "should probably search"
  let allow = false;

  const FRESH_HINTS = [
    "today",
    "yesterday",
    "tomorrow",
    "current",
    "latest",
    "recent",
    "breaking",
    "upcoming",
    "update",
        {
          type: "function",
          name: "list_memories",
          description: "List saved memories, optionally filtered by type.",
          parameters: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: {
                description:
                  "Filter by memory type; use 'all' to list everything.",
                type: "string",
                enum: ["preference", "profile", "project", "context", "other", "all"],
              },
              limit: {
                description: "Maximum number of results to return (default 10).",
                type: "integer",
                minimum: 1,
                maximum: 100,
              },
            },
          },
          strict: true,
        },
    allow = true;
  }

  return { allow, require: false };
}

function referencesEmergingEntity(text: string) {
  if (!text.trim()) {
    return false;
  }
  if (KNOWN_ENTITY_PATTERNS.some((pattern) => pattern.test(text))) {
    return true;
  }
  const lower = text.toLowerCase();
  const hasKeyword = EMERGING_ENTITY_KEYWORDS.some((keyword) =>
    lower.includes(keyword)
  );
  if (!hasKeyword) {
    return false;
  }
  return PRODUCT_STYLE_PATTERN.test(text);
}
*/

type WebSearchAction = {
  type?: string;
  query?: string;
  sources?: Array<{ url?: string }>;
  results?: unknown;
};

type WebSearchCall = {
  id?: string;
  type?: string;
  status?: string;
  query?: string;
  actions?: WebSearchAction[];
  results?: unknown;
  output?: unknown;
  data?: { results?: unknown };
  metadata?: { results?: unknown };
};

// ============================================================================
// resolveWebSearchPreference() and referencesEmergingEntity() removed
// Now using LLM router's webSearchStrategy instead of hardcoded heuristics
// ============================================================================

function mergeDomainLabels(...lists: Array<string[] | undefined>) {
  const merged: string[] = [];
  const seen = new Set<string>();
  lists.forEach((list) => {
    if (!Array.isArray(list)) {
      return;
    }
    list.forEach((label) => {
      if (!label) {
        return;
      }
      const normalized = label.toLowerCase();
      if (seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      merged.push(label);
    });
  });
  return merged;
}

function extractSearchDomainLabelsFromCall(call: WebSearchCall) {
  const urls = collectUrlsFromValue(call);
  const domains: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const domain = extractDomainFromUrl(url);
    if (!domain) continue;
    const label = formatSearchSiteLabel(domain) ?? domain;
    const normalized = label.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    domains.push(label);
  }
  return domains;
}

function collectUrlsFromValue(value: unknown) {
  const urls: string[] = [];
  const stack: unknown[] = value ? [value] : [];
  while (stack.length) {
    const next = stack.pop();
    if (!next) {
      continue;
    }
    if (Array.isArray(next)) {
      stack.push(...next);
      continue;
    }
    if (typeof next === "object") {
      const entry = next as Record<string, unknown>;
      const candidateUrl =
        typeof entry.url === "string"
          ? entry.url
          : typeof entry.link === "string"
            ? entry.link
            : undefined;
      if (candidateUrl) {
        urls.push(candidateUrl);
      }
      if (entry.results) {
        stack.push(entry.results);
      }
      if (entry.actions) {
        stack.push(entry.actions);
      }
      if (entry.output) {
        stack.push(entry.output);
      }
      if (entry.data) {
        stack.push(entry.data);
      }
      if (entry.metadata) {
        stack.push(entry.metadata);
      }
      if (entry.sources) {
        stack.push(entry.sources);
      }
      if (entry.content) {
        stack.push(entry.content);
      }
      if (typeof entry.text === "string") {
        const parsed = safeJsonParse(entry.text);
        if (parsed) {
          stack.push(parsed);
        }
      }
    } else if (typeof next === "string") {
      const parsed = safeJsonParse(next);
      if (parsed) {
        stack.push(parsed);
      }
    }
  }
  return urls;
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    console.log("[chatApi] POST received", {
      conversationId: body.conversationId,
      projectId: body.projectId,
      messagePreview: typeof body.message === 'string' ? body.message.slice(0,80) : null,
      skipUserInsert: body.skipUserInsert,
      timestamp: Date.now(),
    });
    const { conversationId, projectId, message, modelFamilyOverride, speedModeOverride, reasoningEffortOverride, skipUserInsert, forceWebSearch = false, attachments, location } = body;

    if (!conversationId || !message?.trim()) {
      return NextResponse.json(
        { error: "conversationId and message are required" },
        { status: 400 }
      );
    }

    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

    // Check usage limits and calculate usage percentage for progressive restrictions
    const userPlan = await getUserPlan();
    const monthlySpending = await getMonthlySpending();
    const planLimit = getPlanLimit(userPlan);
    const usagePercentage = (monthlySpending / planLimit) * 100;
    
    if (hasExceededLimit(monthlySpending, userPlan)) {
      console.log(`[usageLimit] User ${userId} exceeded limit: $${monthlySpending.toFixed(4)} / $${planLimit}`);
      return NextResponse.json(
        { 
          error: "Usage limit exceeded",
          message: `You've reached your monthly limit of $${planLimit.toFixed(2)}. Please upgrade your plan to continue.`,
          currentSpending: monthlySpending,
          limit: planLimit,
          planType: userPlan,
          forceLimitReachedLabel: true,
        },
        { status: 429 } // Too Many Requests
      );
    }

    // Validate and normalize model settings with progressive restrictions based on usage
    let modelFamily = normalizeModelFamily(modelFamilyOverride ?? "auto");
    const speedMode = normalizeSpeedMode(speedModeOverride ?? "auto");
    const reasoningEffortHint = reasoningEffortOverride;
    
    // Progressive model restrictions based on usage percentage
    if (usagePercentage >= 95) {
      // At 95%+: Only allow Nano
      if (modelFamily !== "gpt-5-nano") {
        console.log(`[usageLimit] User at ${usagePercentage.toFixed(1)}% usage - forcing Nano model`);
        modelFamily = "gpt-5-nano";
      }
    } else if (usagePercentage >= 90) {
      // At 90-95%: Disable GPT 5.1, allow Mini and Nano
      if (modelFamily === "gpt-5.1") {
        console.log(`[usageLimit] User at ${usagePercentage.toFixed(1)}% usage - downgrading from 5.1 to Mini`);
        modelFamily = "gpt-5-mini";
      }
    }
    // Note: Flex processing will be enabled at 80%+ (handled later in the code)

    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;

    // Validate conversation exists and belongs to current user
    const { data: conversationData, error: convError } = await supabaseAny
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (convError || !conversationData) {
      console.error("Conversation validation error:", convError);
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    const conversation = conversationData as ConversationRow;

    // Validate projectId if provided
    if (projectId && conversation.project_id !== projectId) {
      return NextResponse.json(
        { error: "Project ID mismatch" },
        { status: 400 }
      );
    }

    // Load last few messages to check for OpenAI response ID (for context chaining)
    const { data: recentMessages, error: messagesError } = await supabaseAny
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(10);

    if (messagesError) {
      console.error("Failed to load messages:", messagesError);
      return NextResponse.json(
        { error: "Failed to load conversation history" },
        { status: 500 }
      );
    }

    // Last assistant message used for router cache comparisons and metadata
    const lastAssistantMessage = recentMessages?.findLast((m: MessageRow) => m.role === "assistant");
    // Optionally insert the user message unless the client indicates it's already persisted (e.g., first send via server action, or retry)
    let userMessageRow: MessageRow | null = null;
    let permanentInstructionState: { instructions: PermanentInstructionCacheItem[]; metadata: ConversationRow["metadata"] } | null = null;
    let permanentInstructionSummaryForRouter = "No permanent instructions are saved for this user yet.";
    if (!skipUserInsert) {
      const insertResult = await supabaseAny
        .from("messages")
        .insert({
          user_id: userId,
          conversation_id: conversationId,
          role: "user",
          content: message,
          metadata: attachments && attachments.length
            ? { files: attachments.map(a => ({ name: a.name, mimeType: a.mime, dataUrl: a.dataUrl })) }
            : {},
        })
        .select()
        .single();

      if (insertResult.error || !insertResult.data) {
        console.error("Failed to insert user message:", insertResult.error);
        return NextResponse.json(
          { error: "Failed to save user message" },
          { status: 500 }
        );
      }
      userMessageRow = insertResult.data as MessageRow;
    } else if (attachments && attachments.length) {
      // For first message created via server action, persist attachment metadata on the latest user message
      const { data: latestUser, error: latestErr } = await supabaseAny
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!latestErr && latestUser) {
        const nextMeta = {
          ...(latestUser.metadata || {}),
          files: attachments.map(a => ({ name: a.name, mimeType: a.mime, dataUrl: a.dataUrl })),
        } as Record<string, unknown>;
        const { error: updateErr } = await supabaseAny
          .from("messages")
          .update({ metadata: nextMeta })
          .eq("id", latestUser.id);
        if (updateErr) {
          console.warn("Failed to persist attachments on latest user message:", updateErr);
        } else {
          userMessageRow = { ...latestUser, metadata: nextMeta } as MessageRow;
        }
      }
    }
    if (!userMessageRow) {
      const latestFromHistory = recentMessages?.findLast((m: MessageRow) => m.role === "user");
      if (latestFromHistory) {
        userMessageRow = latestFromHistory as MessageRow;
      }
    }

    try {
      permanentInstructionState = await loadPermanentInstructions({
        supabase: supabaseAny,
        userId,
        conversationId,
        conversation,
        forceRefresh: false,
      });
      permanentInstructionSummaryForRouter = buildPermanentInstructionSummaryForRouter(
        permanentInstructionState.instructions
      );
    } catch (permInitErr) {
      console.error("[permanent-instructions] Failed to preload instructions:", permInitErr);
    }

    let resolvedTopicDecision: RouterDecision;
    try {
      resolvedTopicDecision = await decideRoutingForMessage({
        supabase: supabaseAny,
        conversationId,
        userMessage: message,
      });
    } catch (topicErr) {
      console.error("[topic-router] Failed to route message:", topicErr);
      return NextResponse.json(
        { error: "Failed to route conversation topic" },
        { status: 500 }
      );
    }
    console.log(
      `[topic-router] Decision action=${resolvedTopicDecision.topicAction} primary=${resolvedTopicDecision.primaryTopicId ?? "none"} secondary=${resolvedTopicDecision.secondaryTopicIds.length} artifacts=${resolvedTopicDecision.artifactsToLoad.length}`
    );

    if (
      userMessageRow &&
      resolvedTopicDecision.primaryTopicId &&
      userMessageRow.topic_id !== resolvedTopicDecision.primaryTopicId
    ) {
      try {
        await supabaseAny
          .from("messages")
          .update({ topic_id: resolvedTopicDecision.primaryTopicId })
          .eq("id", userMessageRow.id);
        userMessageRow = { ...userMessageRow, topic_id: resolvedTopicDecision.primaryTopicId };
      } catch (topicUpdateErr) {
        console.error("[topic-router] Failed to tag user message topic:", topicUpdateErr);
      }
    }

    if (userMessageRow?.topic_id) {
      try {
        await updateTopicSnapshot({
          supabase: supabaseAny,
          topicId: userMessageRow.topic_id,
          latestMessage: userMessageRow,
        });
      } catch (snapshotErr) {
        console.error("[topic-router] Failed to refresh topic snapshot:", snapshotErr);
      }
    }

    // Get model config using LLM-based routing (with code-based fallback)
      const modelConfig = await getModelAndReasoningConfigWithLLM(
        modelFamily,
        speedMode,
        message,
        reasoningEffortHint,
        usagePercentage,
        userId,
        conversationId,
        {
          permanentInstructionSummary: permanentInstructionSummaryForRouter,
          permanentInstructions:
            (permanentInstructionState?.instructions as unknown as PermanentInstructionToWrite[] | undefined),
        }
      );
    const reasoningEffort = modelConfig.reasoning?.effort ?? "none";

    // Log router usage if LLM routing was used
    if (modelConfig.routedBy === "llm") {
      try {
        const { getRouterUsageEstimate } = await import("@/lib/llm-router");
        const routerUsage = getRouterUsageEstimate();
        const routerCost = calculateCost(
          routerUsage.model,
          routerUsage.inputTokens,
          0, // no cached tokens for router
          routerUsage.outputTokens
        );

        await supabaseAny.from("user_api_usage").insert({
          id: crypto.randomUUID(),
          user_id: userId,
          conversation_id: conversationId,
          model: routerUsage.model,
          input_tokens: routerUsage.inputTokens,
          cached_tokens: 0,
          output_tokens: routerUsage.outputTokens,
          estimated_cost: routerCost,
          created_at: new Date().toISOString(),
        });

        console.log(`[router-usage] Logged LLM router cost: $${routerCost.toFixed(6)}`);
      } catch (routerUsageErr) {
        console.error("[router-usage] Failed to log router usage:", routerUsageErr);
      }
    }

    const {
      messages: contextMessages,
      source: contextSource,
      includedTopicIds,
      summaryCount,
      artifactCount: artifactMessagesCount,
    } = await buildContextForMainModel({
      supabase: supabaseAny,
      conversationId,
      routerDecision: resolvedTopicDecision,
    });
    console.log(
      `[context-builder] ${contextSource} mode - context ${contextMessages.length} msgs (summaries: ${summaryCount}, artifacts: ${artifactMessagesCount}, topics: ${
        includedTopicIds.length ? includedTopicIds.join(", ") : "none"
      })`
    );

    // Smart web search decision based on router (replaces hardcoded heuristics)
    const webSearchStrategy = (modelConfig as any).webSearchStrategy || "optional";
    const allowWebSearch = forceWebSearch || webSearchStrategy !== "never";
    const requireWebSearch = forceWebSearch || webSearchStrategy === "required";
    
    console.log(`[web-search-strategy] Router decision: ${webSearchStrategy} (allow: ${allowWebSearch}, require: ${requireWebSearch})`);

    // Load personalization settings and relevant memories using router's memory strategy
    const personalizationSettings = loadPersonalizationSettings();
    const permanentInstructionWrites = (modelConfig as any).permanentInstructionsToWrite || [];
    let permanentInstructionDeletes = (modelConfig as any).permanentInstructionsToDelete || [];

    // Fallback: infer deletes from the user's request and loaded instructions when the router doesn't supply IDs
    const loadedInstructions = permanentInstructionState?.instructions ?? [];
    const lowerMsg = message.toLowerCase();
    const existingDeleteIds = new Set(
      (permanentInstructionDeletes || []).map((d: any) => d?.id).filter(Boolean)
    );
    const deleteCandidates: { id: string; reason?: string }[] = [];
    const addDeleteIfMissing = (id: string, reason?: string) => {
      if (!id || existingDeleteIds.has(id)) return;
      existingDeleteIds.add(id);
      deleteCandidates.push({ id, reason });
    };

    // Clear-all request
    const wantsFullClear = false; // Intent is determined by router output only
    if (wantsFullClear) {
      for (const inst of loadedInstructions) {
        addDeleteIfMissing(inst.id, "User requested to clear permanent instructions");
      }
    } else {
      // Nickname removal or specific name revocation
      const userWantsNicknameRemoved = /stop\s+call(?:ing)?\s+me|don['’]t\s+call\s+me|do\s+not\s+call\s+me|forget\s+.*call\s+me/i.test(
        lowerMsg
      );
      const nameMatch = lowerMsg.match(/call\s+me\s+([a-z0-9 .,'\"-]+)/i);
      const nameToken = nameMatch?.[1]?.trim().toLowerCase();

      for (const inst of loadedInstructions) {
        const text = `${inst.title || ""} ${inst.content}`.toLowerCase();
        const isNickname = text.includes("call me") || text.includes("address") || text.includes("nickname");
        const mentionsName = nameToken ? text.includes(nameToken) : false;

        if (userWantsNicknameRemoved && (isNickname || mentionsName)) {
          addDeleteIfMissing(inst.id, "User revoked nickname");
        } else if (nameToken && text.includes(nameToken) && lowerMsg.includes("forget")) {
          addDeleteIfMissing(inst.id, "User revoked a named permanent instruction");
        }
      }
    }

    if (deleteCandidates.length) {
      permanentInstructionDeletes = [
        ...(permanentInstructionDeletes || []),
        ...deleteCandidates,
      ];
    }
    let permanentInstructionsChanged = false;
    if (permanentInstructionWrites.length || permanentInstructionDeletes.length) {
      try {
        permanentInstructionsChanged = await applyPermanentInstructionMutations({
          supabase: supabaseAny,
          userId,
          conversationId,
          writes: permanentInstructionWrites,
          deletes: permanentInstructionDeletes,
        });
      } catch (permErr) {
        console.error("[permanent-instructions] Failed to apply router instructions:", permErr);
      }
    }

    if (permanentInstructionsChanged || !permanentInstructionState) {
      try {
        const loadResult = await loadPermanentInstructions({
          supabase: supabaseAny,
          userId,
          conversationId,
          conversation,
          forceRefresh: true,
        });
        permanentInstructionState = loadResult;
      } catch (permReloadErr) {
        console.error("[permanent-instructions] Failed to refresh instructions:", permReloadErr);
      }
    }

    const permanentInstructions: PermanentInstructionCacheItem[] =
      permanentInstructionState?.instructions ?? [];
    const availableMemoryTypes = (modelConfig as any).availableMemoryTypes as string[] | undefined;
    let relevantMemories: MemoryItem[] = [];
    try {
      if (personalizationSettings.referenceSavedMemories) {
        // Get memory strategy from router (default to loading identity if not provided)
        let memoryStrategy: MemoryStrategy = (modelConfig as any).memoryStrategy || {
          types: ["identity"],
          useSemanticSearch: false,
          limit: 10
        };

        const { strategy: augmentedStrategy, addedTypes } =
          augmentMemoryStrategyWithHeuristics(
            memoryStrategy,
            message,
            availableMemoryTypes || []
          );
        memoryStrategy = augmentedStrategy;
        if (addedTypes.length) {
          console.log(`[memory] Heuristic-added memory types: ${addedTypes.join(", ")}`);
        }

        console.log(`[memory] Using strategy:`, JSON.stringify(memoryStrategy));
        relevantMemories = await getRelevantMemories(
          { referenceSavedMemories: true, allowSavingMemory: personalizationSettings.allowSavingMemory },
          memoryStrategy,
          userId, // Pass userId for server-side memory fetch
          conversationId,
          { availableMemoryTypes }
        );
        console.log(`[memory] Loaded ${relevantMemories.length} relevant memories`);
      }
    } catch (error) {
      console.error("[memory] Failed to load memories:", error);
    }


    // Inline file include: allow users to embed <<file:relative/path>> tokens which will be replaced by file content.
    async function expandInlineFileTokens(input: string) {
      const pattern = /<<file:([^>]+)>>/g;
      let match: RegExpExecArray | null;
      let result = input;
      const seen = new Set<string>();
      const replacements: Array<{ token: string; content: string }> = [];
      while ((match = pattern.exec(input))) {
        const relPath = match[1].trim();
        if (!relPath || seen.has(relPath)) continue;
        seen.add(relPath);
        try {
          const res = await fetch(`${request.nextUrl.origin}/api/files/read`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath: relPath }),
          });
          if (!res.ok) {
            continue;
          }
          const data = (await res.json()) as { content?: string };
          if (typeof data.content === "string" && data.content.length) {
            replacements.push({ token: `<<file:${relPath}>>`, content: `\n[File: ${relPath}]\n\n${data.content}\n` });
          }
        } catch {
          // ignore failures; token remains
        }
      }
      for (const r of replacements) {
        result = result.split(r.token).join(r.content);
      }
      return result;
    }

  const expandedMessage = await expandInlineFileTokens(message);
  const attachmentLines = Array.isArray(body.attachments)
    ? body.attachments
        .map((a) => (a?.dataUrl ? `Attachment: ${a.name ?? 'file'} (${a.mime || 'unknown type'})` : ""))
        .filter((line) => line.length > 0)
    : [] as string[];
  let expandedMessageWithAttachments = expandedMessage;
  if (attachmentLines.length) {
    expandedMessageWithAttachments += "\n\n" + attachmentLines.join("\n");
  }
  const openaiFileIds: string[] = [];
  let totalFileUploadSize = 0;
  // Try to reuse an existing vector store from recent messages
  let vectorStoreId: string | undefined;
  let vectorStoreOpenAI: OpenAIClient | null = null;
  try {
    const priorVectorIds: string[] = [];
    for (const msg of (recentMessages || [])) {
      const meta = (msg as { metadata?: unknown }).metadata as Record<string, unknown> | null | undefined;
      const raw = meta && (meta as { vector_store_ids?: unknown }).vector_store_ids;
      if (Array.isArray(raw)) {
        for (const id of raw) {
          if (typeof id === "string" && id.trim().length) priorVectorIds.push(id);
        }
      }
    }
    if (priorVectorIds.length) {
      vectorStoreId = priorVectorIds[priorVectorIds.length - 1];
    }
  } catch {}
  
  if (Array.isArray(body.attachments) && body.attachments.length) {
    console.log(`[chatApi] Processing ${body.attachments.length} attachments`);
    // First pass: collect and upload any non-image files and large images for file_search (PDFs, docs, etc.)
    for (const att of body.attachments) {
      if (!att?.dataUrl) continue;
      
      // Calculate file size from base64 dataUrl
      try {
        const buffer = dataUrlToBuffer(att.dataUrl);
        const fileSize = buffer.length;
        const isImage = typeof att.mime === 'string' && att.mime.startsWith('image/');
        const shouldUpload = !isImage || fileSize > 100 * 1024;
        // Upload to OpenAI for file_search when not a small image
        if (shouldUpload) {
          try {
            // Convert Buffer to Uint8Array for Blob compatibility
            const uint8Array = new Uint8Array(buffer);
            const blob = new Blob([uint8Array], { type: att.mime || "application/octet-stream" });
            const file = new File([blob], att.name || "file", { type: att.mime || "application/octet-stream" });
            
            // Upload to OpenAI vector store directly (like legacy)
            if (!vectorStoreOpenAI) {
              const OpenAIConstructor = await getOpenAIConstructor();
              vectorStoreOpenAI = new OpenAIConstructor({
                apiKey: process.env.OPENAI_API_KEY,
              });
            }
            // Ensure vector store
            if (!vectorStoreId) {
              const vs = await vectorStoreOpenAI.vectorStores.create({
                name: `conversation-${conversationId}`,
                metadata: { conversation_id: conversationId },
              });
              vectorStoreId = vs.id;
              console.log(`Created vector store ${vectorStoreId}`);
            }
            await vectorStoreOpenAI.vectorStores.files.uploadAndPoll(vectorStoreId!, file);
            openaiFileIds.push(att.name || 'file');
            totalFileUploadSize += fileSize;
            console.log(`Uploaded to vector store: ${att.name} (${fileSize} bytes)`);
          } catch (uploadErr) {
            console.error(`Failed to upload ${att.name} to OpenAI:`, uploadErr);
          }
        }
      } catch (sizeErr) {
        console.warn(`Failed to process ${att.name}:`, sizeErr);
      }
    }
    
    // Persist the vector store id if created/uploads succeeded
    if (vectorStoreId) {
      try {
        const latestUser = userMessageRow ?? null;
        if (latestUser) {
          const priorIds = Array.isArray((latestUser.metadata as any)?.vector_store_ids)
            ? ((latestUser.metadata as any).vector_store_ids as string[])
            : [];
          const mergedIds = Array.from(new Set([...priorIds, vectorStoreId]));
          // Safely derive a base metadata object; avoid spreading non-object types
          const baseMeta: Record<string, unknown> =
            latestUser.metadata && typeof latestUser.metadata === "object" && !Array.isArray(latestUser.metadata)
              ? (latestUser.metadata as Record<string, unknown>)
              : {};
          const nextMeta: Record<string, unknown> = {
            ...baseMeta,
            vector_store_ids: mergedIds,
          };
          const { error: updateErr } = await supabaseAny
            .from("messages")
            .update({ metadata: nextMeta })
            .eq("id", latestUser.id);
          if (updateErr) {
            console.warn("Failed to persist vector store id on user message:", updateErr);
          } else {
            userMessageRow = { ...latestUser, metadata: nextMeta } as MessageRow;
          }
        }
      } catch (persistErr) {
        console.warn("Unable to persist vector store id:", persistErr);
      }
    }
    
    // Log vector storage costs if files were uploaded
    if (totalFileUploadSize > 0) {
      try {
        // Estimate 1 day of storage (can be adjusted based on your retention policy)
        const storageEstimatedCost = calculateVectorStorageCost(totalFileUploadSize, 1);
        console.log(`[vectorStorage] Logging storage cost: ${totalFileUploadSize} bytes, cost: $${storageEstimatedCost.toFixed(6)}`);
        
        const { error: storageUsageError } = await supabaseAny
          .from("user_api_usage")
          .insert({
            id: crypto.randomUUID(),
            user_id: userId,
            conversation_id: conversationId,
            model: "vector-storage",
            input_tokens: 0,
            cached_tokens: 0,
            output_tokens: 0,
            estimated_cost: storageEstimatedCost,
          });
        
        if (storageUsageError) {
          console.error("[vectorStorage] Insert error:", storageUsageError);
        } else {
          console.log(`[vectorStorage] Successfully logged storage cost: $${storageEstimatedCost.toFixed(6)}`);
        }
      } catch (storageErr) {
        console.error("[vectorStorage] Failed to log storage cost:", storageErr);
      }
    }
    
    const extractionResults = await Promise.all(
      body.attachments.map(async att => {
        if (!att?.dataUrl) return null;
        console.log(`[chatApi] Extracting content from: ${att.name} (${att.mime})`);
        const buffer = dataUrlToBuffer(att.dataUrl);
        const extraction = await dispatchExtract(
          buffer,
          att.name ?? "attachment",
          att.mime ?? null,
          { userId, conversationId },
        );
        const { preview, meta } = extraction;
        console.log(
          `[chatApi] Extraction result for ${att.name}: ${preview ? preview.length + " chars" : "null"}`,
        );
        const label = att.name || "attachment";
        const fileSize = buffer.length;
        const isLargeFile = fileSize > 100 * 1024;
        const truncationNote = isLargeFile
          ? " [Preview truncated; full content searchable via file_search tool]"
          : "";
        return {
          label,
          preview,
          notes: meta?.notes ?? [],
          truncationNote,
        };
      })
    );

    for (const result of extractionResults) {
      if (!result) continue;
      const previewText = typeof result.preview === "string" ? result.preview : "null";
      expandedMessageWithAttachments += `\n\n[Attachment preview: ${result.label}${result.truncationNote}]\n${previewText}\n`;
      if (result.notes.length) {
        expandedMessageWithAttachments += `Notes: ${result.notes.join(" | ")}\n`;
      }
    }
  }

  console.log(`[chatApi] Final message length: ${expandedMessageWithAttachments.length} chars`);
  console.log(`[chatApi] Vector store ID: ${vectorStoreId || 'none'}`);

  // Build instructions from system prompts with personalization and memories
    const baseSystemInstructions = [
      BASE_SYSTEM_PROMPT,
      "You can inline-read files when the user includes tokens like <<file:relative/path/to/file>> in their prompt. Replace those tokens with the file content and use it in your reasoning.",
      ...(location ? [`User's location: ${location.city} (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}). Use this for location-specific queries like weather, local events, or "near me" searches.`] : []),
      ...(forceWebSearch ? [FORCE_WEB_SEARCH_PROMPT] : []),
      ...(allowWebSearch && requireWebSearch && !forceWebSearch ? [EXPLICIT_WEB_SEARCH_PROMPT] : []),
    ].join("\n\n");

    const systemInstructions = buildSystemPromptWithPersonalization(
      baseSystemInstructions,
      personalizationSettings,
      relevantMemories,
      permanentInstructions
    );

    // Build user content with native image inputs when available to leverage model vision
    const userContentParts: any[] = [
      { type: "input_text", text: expandedMessageWithAttachments },
    ];
    // Include current-turn image attachments directly for vision
    if (Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        const isImage = typeof att?.mime === "string" && att.mime.startsWith("image/");
        if (isImage && att?.dataUrl) {
          userContentParts.push({ type: "input_image", image_url: att.dataUrl });
        }
      }
    }
    // If no current attachments, attempt to reuse the most recent user message's image attachments
    if (!Array.isArray(body.attachments) || body.attachments.length === 0) {
      try {
        const recentUserMessages = (recentMessages || []).filter((m: any) => m.role === "user");
        const latestUser = recentUserMessages[recentUserMessages.length - 1];
        const meta = latestUser ? (latestUser.metadata as Record<string, any> | null) : null;
        const priorFiles: Array<{ name?: string; mimeType?: string; dataUrl?: string }> = Array.isArray(meta?.files)
          ? meta!.files
          : [];
        let added = 0;
        for (const f of priorFiles) {
          if (typeof f?.mimeType === "string" && f.mimeType.startsWith("image/") && typeof f?.dataUrl === "string") {
            userContentParts.push({ type: "input_image", image_url: f.dataUrl });
            added++;
            if (added >= 3) break; // cap to avoid excessive payload
          }
        }
      } catch {}
    }

    const messagesForAPI = [
      ...contextMessages,
      {
        role: "user" as const,
        content: userContentParts,
        type: "message",
      },
    ];

    // Initialize OpenAI client - use dynamic import to avoid hard dependency at build time
    let openai: OpenAIClient;
    
    // Debug: Check if API key is set
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY is not set in environment");
      return NextResponse.json(
        {
          error: "OpenAI API key not configured",
          details: "OPENAI_API_KEY environment variable is missing",
        },
        { status: 500 }
      );
    }
    try {
      const OpenAIClass = await getOpenAIConstructor();
      openai = new OpenAIClass({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.log("OpenAI client initialized successfully");
    } catch (importError) {
      console.error(
        "OpenAI SDK not installed. Please run: npm install openai",
        importError
      );
      return NextResponse.json(
        {
          error:
            "OpenAI SDK not configured. Please install the openai package and set OPENAI_API_KEY.",
        },
        { status: 500 }
      );
    }

    // Use generic Tool to avoid strict preview-only type union on WebSearchTool in SDK types
    const webSearchTool: Tool = { type: "web_search" as any };
    const fileSearchTool = { type: "file_search" as const, ...(vectorStoreId ? { vector_store_ids: [vectorStoreId] } : {}) };
    
    // Memory management is now handled by the router model
    // No need for save_memory tool - router decides what to save based on user prompts
    
    const toolsForRequest: any[] = [];
    
    if (allowWebSearch) {
      toolsForRequest.push(webSearchTool);
    }
    if (vectorStoreId) {
      toolsForRequest.push(fileSearchTool as Tool);
    }
    const toolChoice: ToolChoiceOptions | undefined = allowWebSearch
      ? requireWebSearch
        ? "required"
        : "auto"
      : undefined;
    let responseStream: any;
    try {
      // Progressive flex processing: free users always, all users at 80%+ usage,
      // and GPT-5 Pro forces flex for non-Dev plans.
      const flexEligibleFamilies = ["gpt-5.1", "gpt-5-mini", "gpt-5-nano", "gpt-5-pro-2025-10-06"];
      const isPromptModel = flexEligibleFamilies.includes(modelConfig.resolvedFamily);
      const forceProFlex = modelConfig.resolvedFamily === "gpt-5-pro-2025-10-06" && userPlan !== "dev";
      const usageBasedFlex = (userPlan === "free" || usagePercentage >= 80) && isPromptModel;
      const useFlex = (isPromptModel && forceProFlex) || usageBasedFlex;
      
      if (useFlex && !forceProFlex && usagePercentage >= 80 && userPlan !== "free") {
        console.log(`[usageLimit] User at ${usagePercentage.toFixed(1)}% usage - enabling flex processing`);
      } else if (forceProFlex) {
        console.log(`[usageLimit] Enforcing flex processing for GPT 5 Pro (${userPlan} plan)`);
      }
      
      const rawPromptKey = `${conversationId}:${resolvedTopicDecision.primaryTopicId || "none"}`;
      let promptCacheKey = rawPromptKey;
      if (rawPromptKey.length > 64) {
        promptCacheKey = (await sha256Hex(rawPromptKey)).slice(0, 64);
      }
      const extendedCacheModels = new Set([
        "gpt-5.1",
        "gpt-5.1-codex",
        "gpt-5.1-codex-mini",
        "gpt-5.1-chat-latest",
        "gpt-5",
        "gpt-5-codex",
        "gpt-4.1",
      ]);
      const supportsExtendedCache = extendedCacheModels.has(modelConfig.model);

      // Only include prompt_cache_retention for supported models (not gpt-5-nano)
      const streamOptions: any = {
        model: modelConfig.model,
        instructions: systemInstructions,
        input: messagesForAPI,
        stream: true,
        store: true,
        prompt_cache_key: promptCacheKey,
        // Only use chain when NOT doing enumeration (full strategy needs explicit messages)
        metadata: {
          user_id: userId,
          conversation_id: conversationId,
          ...(userMessageRow?.id ? { message_id: userMessageRow.id } : {}),
        },
      };
      if (supportsExtendedCache) {
        streamOptions.prompt_cache_retention = "24h";
      }
      // Add additional options to streamOptions
      if (projectId) {
        streamOptions.metadata.project_id = projectId;
      }
      if (toolsForRequest.length) {
        streamOptions.tools = toolsForRequest;
      }
      if (toolChoice) {
        streamOptions.tool_choice = toolChoice;
      }
      if (modelConfig.reasoning) {
        streamOptions.reasoning = modelConfig.reasoning;
      }
      if (typeof useFlex !== 'undefined' && useFlex) {
        streamOptions.service_tier = "flex";
      }
      responseStream = await openai.responses.stream(streamOptions);
      console.log("OpenAI stream started for model:", modelConfig.model, useFlex ? "(flex)" : "(standard)");
    } catch (streamErr) {
      console.error("Failed to start OpenAI stream:", streamErr);
      // ...existing code...
      // (fallback error handling unchanged)
    }

    const requestStartMs = Date.now();
    let assistantContent = "";
    let firstTokenAtMs: number | null = null;
    const liveSearchDomainSet = new Set<string>();
    const liveSearchDomainList: string[] = [];
    let assistantMessageRow: MessageRow | null = null;
    let assistantInsertPromise: Promise<MessageRow | null> | null = null;

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const enqueueJson = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };
        // Emit model info immediately so the UI can show effort badges before first token
        enqueueJson({
          model_info: {
            model: modelConfig.model,
            resolvedFamily: modelConfig.resolvedFamily,
            speedModeUsed: speedMode,
            reasoningEffort,
          },
        });
        const sendStatusUpdate = (status: SearchStatusEvent) => {
          enqueueJson({ status });
        };
        const recordLiveSearchDomain = (domain?: string | null) => {
          const label = domain?.trim();
          if (!label) {
            return;
          }
          const normalized = label.toLowerCase();
          if (liveSearchDomainSet.has(normalized)) {
            return;
          }
          liveSearchDomainSet.add(normalized);
          liveSearchDomainList.push(label);
          enqueueJson({ type: "web_search_domain", domain: label });
        };
        const noteDomainsFromCall = (call: WebSearchCall | undefined) => {
          if (!call) {
            return;
          }
          const labels = extractSearchDomainLabelsFromCall(call);
          labels.forEach((label) => recordLiveSearchDomain(label));
        };
        const noteDomainsFromMetadataChunk = (metadata: unknown) => {
          if (!metadata || typeof metadata !== "object") {
            return;
          }
          const entries = Array.isArray(
            (metadata as { web_search?: unknown }).web_search
          )
            ? ((metadata as { web_search?: unknown[] }).web_search ?? [])
            : [];
          entries.forEach((entry) => {
            if (!entry || typeof entry !== "object") {
              return;
            }
            noteDomainsFromCall(entry as WebSearchCall);
          });
        };
        let doneSent = false;

        const ensureAssistantPlaceholder = (initialContent: string) => {
          if (assistantInsertPromise) {
            return;
          }
          assistantInsertPromise = (async () => {
            try {
              const { data, error } = await supabaseAny
                .from("messages")
                .insert({
                  user_id: userId,
                  conversation_id: conversationId,
                  role: "assistant",
                  content: initialContent,
                  metadata: { streaming: true, reasoningEffort },
                  topic_id: resolvedTopicDecision.primaryTopicId ?? null,
                })
                .select()
                .single();
              if (error || !data) {
                console.error("[assistant-stream] Failed to insert placeholder assistant message:", error);
                return null;
              }
              console.log(
                `[assistant-stream] Inserted placeholder assistant message ${data.id} (topic: ${
                  data.topic_id ?? "none"
                })`
              );
              return data as MessageRow;
            } catch (insertErr) {
              console.error("[assistant-stream] Insert error:", insertErr);
              return null;
            }
          })();

          assistantInsertPromise.then((row) => {
            if (row) {
              assistantMessageRow = row;
            }
          });
        };

        try {
          for await (const event of responseStream) {
            const chunkMetadata =
              event && typeof event === "object"
                ? (event as { metadata?: unknown }).metadata
                : null;
            if (chunkMetadata) {
              noteDomainsFromMetadataChunk(chunkMetadata);
            }
            if (event.type === "response.output_text.delta" && event.delta) {
              const token = event.delta;
              assistantContent += token;
              if (!assistantInsertPromise) {
                ensureAssistantPlaceholder(assistantContent);
              }
              enqueueJson({ token });
              if (!firstTokenAtMs) {
                firstTokenAtMs = Date.now();
                // Send model metadata on first token so UI can update model tag immediately
                enqueueJson({
                  model_info: {
                    model: modelConfig.model,
                    resolvedFamily: modelConfig.resolvedFamily,
                    speedModeUsed: speedMode,
                    reasoningEffort,
                  },
                });
              }
            } else if (
              event.type === "response.web_search_call.in_progress" ||
              event.type === "response.web_search_call.searching"
            ) {
              sendStatusUpdate({
                type: "search-start",
                query: (event as { query?: string }).query ?? "web search",
              });
            } else if (event.type === "response.web_search_call.completed") {
              sendStatusUpdate({
                type: "search-complete",
                query: (event as { query?: string }).query ?? "web search",
              });
              noteDomainsFromCall((event as { item?: unknown }).item as WebSearchCall);
            } else if (event.type === "response.file_search_call.in_progress") {
              sendStatusUpdate({
                type: "file-search-start",
                query: (event as { query?: string }).query ?? "file search",
              });
            } else if (event.type === "response.file_search_call.completed") {
              sendStatusUpdate({
                type: "file-search-complete",
                query: (event as { query?: string }).query ?? "file search",
              });
            } else if (event.type === "response.function_call.in_progress") {
              // Memory tool called
              const functionName = (event as any).function?.name;
              if (functionName) {
                sendStatusUpdate({
                  type: "search-start",
                  query: `${functionName}...`,
                });
              }
            } else if (event.type === "response.function_call.completed") {
              // Function calls are processed by streaming
              // Memory writing is now handled by router before the response starts
              const call = event as any;
              const functionName = call.function?.name;
              
              sendStatusUpdate({
                type: "search-complete",
                query: functionName || "function call",
              });
              
              console.log(`[function-tool] Function call completed: ${functionName}`);
            } else if (
              event.type === "response.output_item.added" ||
              event.type === "response.output_item.done"
            ) {
              noteDomainsFromCall((event as { item?: unknown }).item as WebSearchCall);
            }
          }

          const finalResponse = await responseStream.finalResponse();
          if (finalResponse.output_text) {
            assistantContent = finalResponse.output_text;
          }

          // Extract usage information for cost tracking
          console.log("[usage] Final response object:", JSON.stringify(finalResponse, null, 2));
          const usage = finalResponse.usage || {};
          
          // Log the full usage object structure to debug cache tokens
          console.log("[usage] Full usage object:", JSON.stringify(usage, null, 2));
          
          const inputTokens = usage.input_tokens || 0;
          
          // Try multiple possible field names for cached tokens
          const cachedTokens = 
            usage.input_tokens_details?.cached_tokens || 
            usage.input_tokens_details?.cache_read_input_tokens ||
            usage.cached_input_tokens ||
            usage.cache_read_tokens ||
            0;
          
          const outputTokens = usage.output_tokens || 0;

          console.log("[usage] Extracted tokens:", {
            inputTokens,
            cachedTokens,
            outputTokens,
            model: modelConfig.model,
            rawUsageKeys: Object.keys(usage),
          });

          // Calculate cost
          const estimatedCost = calculateCost(
            modelConfig.model,
            inputTokens,
            cachedTokens,
            outputTokens
          );

          console.log("[usage] Calculated cost:", estimatedCost);

          // Log usage to database
          if (inputTokens > 0 || outputTokens > 0) {
            try {
              const insertData = {
                id: crypto.randomUUID(),
                user_id: userId,
                conversation_id: conversationId,
                model: modelConfig.model,
                input_tokens: inputTokens,
                cached_tokens: cachedTokens,
                output_tokens: outputTokens,
                estimated_cost: estimatedCost,
                created_at: new Date().toISOString(),
              };
              console.log("[usage] Attempting to insert:", insertData);
              
              const { error } = await supabaseAny.from("user_api_usage").insert(insertData);
              
              if (error) {
                console.error("[usage] Insert error:", error);
              } else {
                console.log(
                  `[usage] Successfully logged: ${inputTokens} input, ${cachedTokens} cached, ${outputTokens} output, cost: $${estimatedCost.toFixed(6)}`
                );
              }
            } catch (usageErr) {
              console.error("[usage] Failed to log usage:", usageErr);
            }
          } else {
            console.warn("[usage] No tokens to log (both input and output are 0)");
          }

          const thinkingDurationMs =
            typeof firstTokenAtMs === "number"
              ? Math.max(firstTokenAtMs - requestStartMs, 0)
              : Math.max(Date.now() - requestStartMs, 0);
          const metadataPayload = buildAssistantMetadataPayload({
            base: {
              modelUsed: modelConfig.model,
              reasoningEffort,
              resolvedFamily: modelConfig.resolvedFamily,
              speedModeUsed: speedMode,
              userRequestedFamily: modelFamily,
              userRequestedSpeedMode: speedMode,
              userRequestedReasoningEffort: reasoningEffortHint,
              routedBy: modelConfig.routedBy, // Track routing method
            },
            content: assistantContent,
            thinkingDurationMs,
          });
          const combinedDomains = mergeDomainLabels(
            metadataPayload.searchedDomains,
            liveSearchDomainList
          );
          if (combinedDomains.length) {
            metadataPayload.searchedDomains = combinedDomains;
            metadataPayload.searchedSiteLabel =
              combinedDomains[combinedDomains.length - 1] ||
              metadataPayload.searchedSiteLabel;
          }

          const resolveAssistantRow = async (): Promise<MessageRow | null> => {
            if (assistantMessageRow) {
              return assistantMessageRow;
            }
            if (assistantInsertPromise) {
              assistantMessageRow = await assistantInsertPromise;
              return assistantMessageRow;
            }
            return null;
          };

          let persistedAssistantRow = await resolveAssistantRow();

          if (persistedAssistantRow) {
            const { data: updatedRow, error: updateErr } = await supabaseAny
              .from("messages")
              .update({
                content: assistantContent,
                openai_response_id: finalResponse.id || null,
                metadata: metadataPayload,
              })
              .eq("id", persistedAssistantRow.id)
              .select()
              .single();

            if (updateErr || !updatedRow) {
              console.error("[assistant-stream] Failed to finalize assistant message:", updateErr);
            } else {
              assistantMessageRow = updatedRow as MessageRow;
              persistedAssistantRow = assistantMessageRow;
            }
          }

          if (!persistedAssistantRow) {
            const { data: insertedRow, error: assistantError } = await supabaseAny
              .from("messages")
              .insert({
                user_id: userId,
                conversation_id: conversationId,
                role: "assistant",
                content: assistantContent,
                openai_response_id: finalResponse.id || null,
                metadata: metadataPayload,
                topic_id: resolvedTopicDecision.primaryTopicId ?? null,
              })
              .select()
              .single();

            if (assistantError || !insertedRow) {
              console.error("Failed to save assistant message:", assistantError);
            } else {
              assistantMessageRow = insertedRow as MessageRow;
              persistedAssistantRow = assistantMessageRow;
            }
          }

          const assistantRowForMeta = persistedAssistantRow;

          if (!assistantRowForMeta) {
            enqueueJson({
              meta: {
                assistantMessageRowId: `error-${Date.now()}`,
                userMessageRowId: userMessageRow?.id,
                model: modelConfig.model,
                reasoningEffort,
                resolvedFamily: modelConfig.resolvedFamily,
                speedModeUsed: speedMode,
                metadata: metadataPayload,
              },
            });
          } else {
            try {
              const memoriesToWrite = (modelConfig as any).memoriesToWrite || [];
              if (personalizationSettings.allowSavingMemory && memoriesToWrite.length > 0) {
                console.log(`[router-memory] Writing ${memoriesToWrite.length} memories from router decision`);

                for (const memory of memoriesToWrite) {
                  await writeMemory({
                    type: memory.type,
                    title: memory.title,
                    content: memory.content,
                    enabled: true,
                    conversationId,
                  });
                  console.log(`[router-memory] Wrote memory: ${memory.title} (type: ${memory.type})`);
                }
              }

              const memoriesToDelete = (modelConfig as any).memoriesToDelete || [];
              if (memoriesToDelete.length > 0) {
                console.log(`[router-memory] Deleting ${memoriesToDelete.length} memories from router decision`);

                for (const memDel of memoriesToDelete) {
                  try {
                    await deleteMemory(memDel.id, userId);
                    console.log(`[router-memory] Deleted memory: ${memDel.id} (reason: ${memDel.reason})`);
                  } catch (delErr) {
                    console.error(`[router-memory] Failed to delete memory ${memDel.id}:`, delErr);
                  }
                }
              }
            } catch (memError) {
              console.error("[router-memory] Failed to write/delete memories from router:", memError);
            }

            enqueueJson({
              meta: {
                assistantMessageRowId: assistantRowForMeta.id,
                userMessageRowId: userMessageRow?.id,
                model: modelConfig.model,
                reasoningEffort,
                resolvedFamily: modelConfig.resolvedFamily,
                speedModeUsed: speedMode,
                metadata:
                  (assistantRowForMeta.metadata as AssistantMessageMetadata | null) ??
                  metadataPayload,
              },
            });

            if (assistantRowForMeta.topic_id) {
              try {
                await updateTopicSnapshot({
                  supabase: supabaseAny,
                  topicId: assistantRowForMeta.topic_id,
                  latestMessage: assistantRowForMeta,
                });
              } catch (snapshotErr) {
                console.error("[topic-router] Failed to refresh topic snapshot for assistant:", snapshotErr);
              }
              try {
                await refreshTopicMetadata({
                  supabase: supabaseAny,
                  openai,
                  topicId: assistantRowForMeta.topic_id,
                  conversationId,
                });
              } catch (metaErr) {
                console.error("[topic-router] Failed to refresh topic metadata summary:", metaErr);
              }
            }

            try {
              await maybeExtractArtifactsFromMessage({
                supabase: supabaseAny,
                message: assistantRowForMeta,
              });
            } catch (artifactError) {
              console.error("[artifacts] Extraction failed:", artifactError);
            }
          }
        } catch (error) {
          console.error("Stream error:", error);
          enqueueJson({ error: "upstream_error" });
        } finally {
          if (!doneSent) {
            enqueueJson({ done: true });
            doneSent = true;
          }
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("Chat API error:", {
      message: errorMessage,
      stack: errorStack,
      error,
    });
    // Graceful NDJSON fallback instead of 500 to avoid client crashes
    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const enqueueJson = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };
        try {
          enqueueJson({ error: "internal_error", details: errorMessage });
          enqueueJson({ token: "Sorry, something went wrong starting the model. Please retry." });
          enqueueJson({ done: true });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(readableStream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json()) as { messageId: string };
    const { messageId } = body;

    if (!messageId) {
      return NextResponse.json(
        { error: "messageId is required" },
        { status: 400 }
      );
    }

    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;

    // Delete the message from Supabase
    // First verify the message belongs to the current user's conversation
    const { data: message, error: fetchError } = await supabaseAny
      .from("messages")
      .select("id, conversation_id")
      .eq("id", messageId)
      .single();

    if (fetchError || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    // Verify conversation belongs to user
    const { data: conversation, error: convError } = await supabaseAny
      .from("conversations")
      .select("id, user_id")
      .eq("id", message.conversation_id)
      .single();

    if (convError || !conversation || conversation.user_id !== userId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Delete the message
    const { error: deleteError } = await supabaseAny
      .from("messages")
      .delete()
      .eq("id", messageId);

    if (deleteError) {
      console.error("Error deleting message:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete message" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Delete API error:", errorMessage);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
