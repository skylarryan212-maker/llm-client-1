export const runtime = "nodejs";
export const maxDuration = 60; // Allow up to 60 seconds for file processing

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import { getModelAndReasoningConfig, getModelAndReasoningConfigWithLLM } from "@/lib/modelConfig";
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
  WebSearchTool,
} from "openai/resources/responses/responses";
import { calculateCost, calculateVectorStorageCost } from "@/lib/pricing";
import { getUserPlan } from "@/app/actions/plan-actions";
import { getMonthlySpending } from "@/app/actions/usage-actions";
import { hasExceededLimit, getPlanLimit } from "@/lib/usage-limits";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type OpenAIClient = any;

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
  "You are a web-connected assistant with access to the `web_search` tool for live information and the `file_search` tool for semantic document search.\n" +
  "Follow these rules:\n" +
  "- Use internal knowledge for timeless concepts, math, or historical context.\n" +
  "- For questions about current events, market conditions, weather, schedules, releases, or other fast-changing facts, prefer calling `web_search` to gather fresh data.\n" +
  "- When `web_search` returns results, treat them as live, up-to-date sources. Summarize them, cite domains inline using (Source: domain.com), and close with a short Sources list that repeats the referenced domains.\n" +
  "- Never claim you lack internet access or that your knowledge is outdated in a turn where tool outputs were provided.\n" +
  "- If the tool returns little or no information, acknowledge that gap before relying on older knowledge.\n" +
  "- Do not send capability or identity questions to `web_search`; answer those directly.\n" +
  "- Keep answers clear and grounded, blending background context with any live data you retrieved.\n" +
  "- When the user provides attachment URLs (marked as 'Attachment: name -> url'), fetch and read those documents directly from the URL without asking the user to re-upload. Use their contents in your reasoning and summarize as requested.\n" +
  "- If an attachment preview is marked as '[Preview truncated; full content searchable via file_search tool]', you can use the `file_search` tool to query specific information from the full document (e.g., 'find pricing section', 'extract all dates', 'summarize chapter 3').\n" +
  "- If an attachment is an image, extract any visible text (OCR) and use it in your reasoning along with a description if helpful.\n" +
  "- IMPORTANT: When a user asks to 'list my prompts' or 'show my messages', only list the TEXT they typed. Do NOT list file contents, document excerpts, or attachment names as if they were prompts. The marker '[Files attached]' indicates files were included but is not part of the prompt.";

const FORCE_WEB_SEARCH_PROMPT =
  "The user explicitly requested live web search. Ensure you call the `web_search` tool for this turn unless it would clearly be redundant.";

const EXPLICIT_WEB_SEARCH_PROMPT =
  "The user asked for live sources or links. You must call the `web_search` tool, base your answer on those results, and cite them directly.";

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
  "breaking",
  "news",
  "update",
  "updated",
  "now",
  "right now",
  "this week",
  "this month",
  "this year",
  "price",
  "prices",
  "market",
  "stock",
  "stocks",
  "quote",
  "report",
  "earnings",
  "forecast",
  "weather",
  "temperature",
  "release",
  "launch",
  "trend",
];

const EMERGING_ENTITY_KEYWORDS = [
  "buy",
  "purchase",
  "preorder",
  "pre-order",
  "release",
  "released",
  "launch",
  "launched",
  "announce",
  "announced",
  "available",
  "availability",
  "in stock",
  "stock",
  "price",
  "prices",
  "cost",
  "ticket",
  "tickets",
  "order",
  "exists",
  "exist",
  "new",
  "latest",
  "upcoming",
];

const KNOWN_ENTITY_PATTERNS = [
  /rtx\s?\d{3,4}/i,
  /geforce/i,
  /radeon/i,
  /iphone/i,
  /galaxy/i,
  /pixel/i,
  /tesla/i,
  /model\s?[sx3y]/i,
  /macbook/i,
  /ipad/i,
  /playstation/i,
  /xbox/i,
  /gpu/i,
  /cpu/i,
  /summit/i,
  /conference/i,
  /expo/i,
  /festival/i,
  /tournament/i,
  /world cup/i,
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
    "news",
    "newest",
    "release",
    "launch",
    "schedule",
  ];
  if (FRESH_HINTS.some((hint) => lower.includes(hint))) {
    allow = true;
  }

  if (/\b20(2[0-9]|3[0-9])\b/.test(lower)) {
    allow = true;
  }

  if (/\b(?:price|pricing|cost|buy|sell|stock|earnings|forecast|availability|ticket|ranking|score|game|match)\b/i.test(trimmed)) {
    allow = true;
  }

  if (/\b(?:what|who|when|where|which|compare|vs\.?)\b/i.test(trimmed) && trimmed.length > 40) {
    allow = true;
  }

  if (/https?:\/\//i.test(trimmed) || /\bwww\./i.test(trimmed)) {
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

function isWebSearchCall(value: unknown): value is WebSearchCall {
  return (
    Boolean(value && typeof value === "object") &&
    (value as { type?: string }).type === "web_search_call"
  );
}

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
    const { data: conversation, error: convError } = await supabaseAny
      .from("conversations")
      .select("*")
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (convError || !conversation) {
      console.error("Conversation validation error:", convError);
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

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

    // Check if we have an OpenAI response chain we can continue
    const lastAssistantMessage = recentMessages?.findLast((m: MessageRow) => m.role === "assistant");
    const previousResponseId = lastAssistantMessage?.openai_response_id || null;

    // Optionally insert the user message unless the client indicates it's already persisted (e.g., first send via server action, or retry)
    let userMessageRow: MessageRow | null = null;
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

    // Get model config using LLM-based routing (with code-based fallback)
    const modelConfig = await getModelAndReasoningConfigWithLLM(
      modelFamily, 
      speedMode, 
      message, 
      reasoningEffortHint,
      usagePercentage
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

        const { randomUUID } = require("crypto");
        await supabaseAny.from("user_api_usage").insert({
          id: randomUUID(),
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

    // Smart context loading based on router decision
    let contextMessagesToLoad: MessageRow[] = [];
    const contextStrategy = (modelConfig as any).contextStrategy || "recent"; // Default to recent if not present
    
    if (contextStrategy === "minimal") {
      // Use cache only, don't load history
      contextMessagesToLoad = [];
      console.log(`[context-strategy] Using minimal - cache only (0 messages loaded)`);
    } else if (contextStrategy === "recent") {
      // If chain exists, trust it completely (don't send explicit messages)
      // Only load from DB when starting fresh (no chain)
      if (previousResponseId) {
        contextMessagesToLoad = [];
        console.log(`[context-strategy] Using recent with chain - relying on OpenAI cache (0 explicit messages)`);
      } else {
        const { data: recentHistory, error: recentError } = await supabaseAny
          .from("messages")
          .select("*")
          .eq("conversation_id", conversationId)
          .order("created_at", { ascending: true })
          .limit(15);
        
        if (recentError) {
          console.error("Failed to load recent history:", recentError);
        } else {
          contextMessagesToLoad = recentHistory || [];
        }
        console.log(`[context-strategy] Using recent without chain - loaded ${contextMessagesToLoad.length} messages from DB`);
      }
    } else if (contextStrategy === "full") {
      // Load all messages for enumeration/recall
      // User explicitly wants to list/count messages, so we need explicit data
      // Send explicit messages WITHOUT previous_response_id to avoid duplication
      const { data: fullHistory, error: fullError } = await supabaseAny
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(100);  // Cap at 100 for safety
      
      if (fullError) {
        console.error("Failed to load full history:", fullError);
      } else {
        // Exclude the current user message (just inserted) to avoid duplication
        // It will be added separately in messagesForAPI
        contextMessagesToLoad = (fullHistory || []).filter(
          (msg: MessageRow) => msg.id !== userMessageRow?.id
        );
      }
      console.log(`[context-strategy] Using full - loaded ${contextMessagesToLoad.length} messages for enumeration (excluding current)`);
    }

    // Smart web search decision based on router (replaces hardcoded heuristics)
    const webSearchStrategy = (modelConfig as any).webSearchStrategy || "optional";
    const allowWebSearch = forceWebSearch || webSearchStrategy !== "never";
    const requireWebSearch = forceWebSearch || webSearchStrategy === "required";
    
    console.log(`[web-search-strategy] Router decision: ${webSearchStrategy} (allow: ${allowWebSearch}, require: ${requireWebSearch})`);


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
    : [];

  // Helper to convert dataUrl to buffer
  function dataUrlToBuffer(dataUrl: string): Buffer {
    const base64Data = dataUrl.split(",")[1] || dataUrl;
    return Buffer.from(base64Data, "base64");
  }

  let expandedMessageWithAttachments = expandedMessage;
    if (attachmentLines.length) {
      expandedMessageWithAttachments += `\n\n${attachmentLines.join("\n")}`;
      // Emit a file-reading-start status for client UI
      // Note: actual streaming statuses are sent later, but we will include previews inline here.
    }

  // Upload files to OpenAI vector store for persistent file_search across turns
  const openaiFileIds: string[] = [];
  let totalFileUploadSize = 0;
  // Try to reuse an existing vector store from recent messages
  let vectorStoreId: string | undefined;
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
            const { OpenAI } = require("openai");
            const tempOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            // Ensure vector store
            if (!vectorStoreId) {
              const vs = await tempOpenAI.vectorStores.create({
                name: `conversation-${conversationId}`,
                metadata: { conversation_id: conversationId },
              });
              vectorStoreId = vs.id;
              console.log(`Created vector store ${vectorStoreId}`);
            }
            await tempOpenAI.vectorStores.files.uploadAndPoll(vectorStoreId!, file);
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
    
    // Second pass: extract previews for all files (no HEAD requests for dataUrls)
    for (const att of body.attachments) {
      if (!att?.dataUrl) continue;
      console.log(`[chatApi] Extracting content from: ${att.name} (${att.mime})`);
      const buffer = dataUrlToBuffer(att.dataUrl);
      const extraction = await dispatchExtract(
        buffer,
        att.name ?? "attachment",
        att.mime ?? null,
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
      expandedMessageWithAttachments += `\n\n[Attachment preview: ${label}${truncationNote}]\n${preview}\n`;
      if (meta?.notes?.length) {
        expandedMessageWithAttachments += `Notes: ${meta.notes.join(" | ")}\n`;
      }
    }
  }

  console.log(`[chatApi] Final message length: ${expandedMessageWithAttachments.length} chars`);
  console.log(`[chatApi] Vector store ID: ${vectorStoreId || 'none'}`);

  // Build instructions from system prompts (cleaner than bundling in input)
    const systemInstructions = [
      BASE_SYSTEM_PROMPT,
      "You can inline-read files when the user includes tokens like <<file:relative/path/to/file>> in their prompt. Replace those tokens with the file content and use it in your reasoning.",
      ...(location ? [`User's location: ${location.city} (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}). Use this for location-specific queries like weather, local events, or "near me" searches.`] : []),
      ...(forceWebSearch ? [FORCE_WEB_SEARCH_PROMPT] : []),
      ...(allowWebSearch && requireWebSearch && !forceWebSearch ? [EXPLICIT_WEB_SEARCH_PROMPT] : []),
    ].join("\n\n");

    // Helper to clean message content by removing file attachment metadata
    // This prevents the model from confusing attachments with actual user prompts
    const cleanMessageContent = (msg: MessageRow): string => {
      let content = msg.content ?? "";
      
      // Only clean user messages with file metadata
      if (msg.role === "user") {
        const meta = msg.metadata as Record<string, any> | null | undefined;
        if (meta?.files && Array.isArray(meta.files) && meta.files.length > 0) {
          // Remove inline "Attachment: filename" lines that were added to the message
          const attachmentPattern = /\n\nAttachment: [^\n]+ \([^)]+\)(?:\n|$)/g;
          content = content.replace(attachmentPattern, "");
          
          // Add a subtle marker that files were attached (without including them in content)
          if (content && !content.includes("[Files attached]")) {
            content = content.trim() + " [Files attached]";
          }
        }
      }
      
      return content;
    };

    // Build history messages based on context strategy
    const historyMessages = contextMessagesToLoad.map((msg: MessageRow) => ({
      role: msg.role as "user" | "assistant",
      content: cleanMessageContent(msg),
      type: "message",
    }));

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
      ...historyMessages,
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
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const OpenAIModule = require("openai");
      const OpenAIClass = OpenAIModule.default || OpenAIModule;
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
    const toolsForRequest: Tool[] = [];
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

    const includeFields = [];
    if (allowWebSearch) {
      includeFields.push("web_search_call.results", "web_search_call.action.sources");
    }
    if (vectorStoreId) {
      includeFields.push("file_search_call.results");
    }
    const finalIncludeFields = includeFields.length > 0 ? includeFields : undefined;

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
      
      responseStream = await openai.responses.stream({
        model: modelConfig.model,
        instructions: systemInstructions,
        input: messagesForAPI,
        stream: true,
        store: true,
        // Only use chain when NOT doing enumeration (full strategy needs explicit messages)
        ...(previousResponseId && contextStrategy !== "full" ? { previous_response_id: previousResponseId } : {}),
        metadata: {
          user_id: userId,
          conversation_id: conversationId,
          ...(userMessageRow?.id ? { message_id: userMessageRow.id } : {}),
          ...(projectId ? { project_id: projectId } : {}),
        },
        ...(toolsForRequest.length ? { tools: toolsForRequest } : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        ...(finalIncludeFields ? { include: finalIncludeFields } : {}),
        ...(modelConfig.reasoning && { reasoning: modelConfig.reasoning }),
        ...(useFlex ? { service_tier: "flex" } : {}),
      });
      console.log("OpenAI stream started for model:", modelConfig.model, useFlex ? "(flex)" : "(standard)", contextStrategy === "full" ? "(no chain - explicit enumeration)" : "");
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

    const readableStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const enqueueJson = (payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        };
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
            usingChain: !!previousResponseId && contextStrategy !== "full",
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
              const { randomUUID } = require("crypto");
              const insertData = {
                id: randomUUID(),
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
              
              const { data, error } = await supabaseAny.from("user_api_usage").insert(insertData);
              
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

          const { data: assistantMessageRow, error: assistantError } =
            await supabaseAny
              .from("messages")
              .insert({
                user_id: userId,
                conversation_id: conversationId,
                role: "assistant",
                content: assistantContent,
                openai_response_id: finalResponse.id || null,
                metadata: metadataPayload,
              })
              .select()
              .single();

          if (assistantError || !assistantMessageRow) {
            console.error(
              "Failed to save assistant message:",
              assistantError
            );
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
            enqueueJson({
              meta: {
                assistantMessageRowId: assistantMessageRow.id,
                userMessageRowId: userMessageRow?.id,
                model: modelConfig.model,
                reasoningEffort,
                resolvedFamily: modelConfig.resolvedFamily,
                speedModeUsed: speedMode,
                metadata:
                  (assistantMessageRow.metadata as AssistantMessageMetadata | null) ??
                  metadataPayload,
              },
            });
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

    return new NextResponse(readableStream, {
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
    return new NextResponse(readableStream, {
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
