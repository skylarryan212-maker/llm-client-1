export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import { getModelAndReasoningConfig } from "@/lib/modelConfig";
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
import type {
  Tool,
  ToolChoiceOptions,
  WebSearchTool,
} from "openai/resources/responses/responses";

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
  attachments?: Array<{ name?: string; mime?: string; url: string }>;
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
  "- If an attachment is an image, extract any visible text (OCR) and use it in your reasoning along with a description if helpful.";

const FORCE_WEB_SEARCH_PROMPT =
  "The user explicitly requested live web search. Ensure you call the `web_search` tool for this turn unless it would clearly be redundant.";

const EXPLICIT_WEB_SEARCH_PROMPT =
  "The user asked for live sources or links. You must call the `web_search` tool, base your answer on those results, and cite them directly.";

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
  if (META_QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allow: false, require: false };
  }
  if (MUST_WEB_SEARCH_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allow: true, require: true };
  }
  if (SOURCE_REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { allow: true, require: true };
  }
  const lower = trimmed.toLowerCase();
  let allow = false;
  if (LIVE_DATA_HINTS.some((hint) => lower.includes(hint))) {
    allow = true;
  }
  if (/https?:\/\//i.test(trimmed) || /\bwww\./i.test(trimmed)) {
    allow = true;
  }
  if (
    /\b(?:price|pricing|cost|buy|purchase|availability|in stock|market|stocks?|earnings|forecast|release date|launch|ticket|schedule|ranking|news|headline)\b/i.test(
      trimmed
    )
  ) {
    allow = true;
  }
  if (/\bsources?\b/i.test(trimmed) || /\breference\b/i.test(trimmed)) {
    allow = true;
  }
  if (referencesEmergingEntity(trimmed)) {
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
    const { conversationId, projectId, message, modelFamilyOverride, speedModeOverride, reasoningEffortOverride, skipUserInsert, forceWebSearch = false, attachments } = body;

    // Validate and normalize model settings
    const modelFamily = normalizeModelFamily(modelFamilyOverride ?? "auto");
    const speedMode = normalizeSpeedMode(speedModeOverride ?? "auto");
    const reasoningEffortHint = reasoningEffortOverride;

    if (!conversationId || !message?.trim()) {
      return NextResponse.json(
        { error: "conversationId and message are required" },
        { status: 400 }
      );
    }

    const userId = getCurrentUserId();
    if (!userId) {
      return NextResponse.json(
        { error: "User not authenticated" },
        { status: 401 }
      );
    }

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

    // Load recent messages for context (up to 50)
    const { data: recentMessages, error: messagesError } = await supabaseAny
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(50);

    if (messagesError) {
      console.error("Failed to load messages:", messagesError);
      return NextResponse.json(
        { error: "Failed to load conversation history" },
        { status: 500 }
      );
    }

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
            ? { files: attachments.map(a => ({ name: a.name, mimeType: a.mime, url: a.url })) }
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
          files: attachments.map(a => ({ name: a.name, mimeType: a.mime, url: a.url })),
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

    // Get model config with optional reasoning effort override
    const modelConfig = getModelAndReasoningConfig(modelFamily, speedMode, message, reasoningEffortHint);
    const reasoningEffort = modelConfig.reasoning?.effort ?? "none";

    const { allow: allowWebSearch, require: requireWebSearch } = resolveWebSearchPreference({
      userText: message,
      forceWebSearch,
    });

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
        .map((a) => (a?.url ? `Attachment: ${a.name ?? 'file'} -> ${a.url}` : ""))
        .filter((line) => line.length > 0)
    : [];

  // Comprehensive server-side attachment extraction
  async function extractAttachmentContent(url: string, name?: string | null, mime?: string | null) {
    try {
      console.log(`[extractAttachmentContent] Fetching ${name || 'unknown'} from ${url.slice(0, 60)}...`);
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) {
        console.warn(`[extractAttachmentContent] Failed to fetch: ${res.status} ${res.statusText}`);
        return null;
      }
      const contentType = mime || res.headers.get("content-type") || "";
      const lower = contentType.toLowerCase();
      const buf = await res.arrayBuffer();
      const buffer = Buffer.from(buf);

      // PDF extraction
      if (lower.includes("pdf")) {
        console.log(`[extractAttachmentContent] Attempting PDF extraction for ${name}`);
        try {
          // Try pdf2json first (Node.js friendly)
          const PDFParser = require("pdf2json");
          const pdfParser = new PDFParser();
          
          const text = await new Promise<string>((resolve, reject) => {
            pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
              try {
                // Extract text from all pages
                const texts: string[] = [];
                if (pdfData.Pages) {
                  for (const page of pdfData.Pages) {
                    if (page.Texts) {
                      for (const text of page.Texts) {
                        if (text.R) {
                          for (const r of text.R) {
                            if (r.T) {
                              texts.push(decodeURIComponent(r.T));
                            }
                          }
                        }
                      }
                    }
                  }
                }
                resolve(texts.join(" "));
              } catch (err) {
                reject(err);
              }
            });
            
            pdfParser.on("pdfParser_dataError", (errData: any) => {
              reject(new Error(errData.parserError));
            });
            
            pdfParser.parseBuffer(buffer);
          });
          
          console.log(`[extractAttachmentContent] PDF extracted ${text.length} chars from ${name}`);
          const preview = text.slice(0, 32768); // ~32KB cap
          return preview.trim().length ? preview : null;
        } catch (pdfErr) {
          console.error(`[extractAttachmentContent] PDF extraction failed:`, pdfErr);
          // Fallback: try to extract raw text if it's a text-based PDF
          try {
            const rawText = buffer.toString("utf-8");
            if (rawText.includes("stream") && rawText.includes("endstream")) {
              console.log(`[extractAttachmentContent] Attempting raw text extraction from ${name}`);
              const preview = rawText.slice(0, 32768);
              return preview.trim().length > 100 ? preview : null;
            }
          } catch {}
          return null;
        }
      }

      // DOCX extraction
      if (lower.includes("wordprocessingml") || lower.includes("msword") || name?.toLowerCase().endsWith(".docx")) {
        try {
          const mammoth = require("mammoth");
          const result = await mammoth.extractRawText({ buffer });
          const text = result.value || "";
          const preview = text.slice(0, 32768);
          return preview.trim().length ? preview : null;
        } catch {
          return null;
        }
      }

      // PPTX extraction
      if (lower.includes("presentationml") || name?.toLowerCase().endsWith(".pptx")) {
        try {
          const JSZip = require("jszip");
          const zip = await JSZip.loadAsync(buffer);
          const slideTexts: string[] = [];
          const slideFiles = Object.keys(zip.files).filter(f => f.startsWith("ppt/slides/slide") && f.endsWith(".xml"));
          for (const slideFile of slideFiles.slice(0, 20)) {
            const content = await zip.files[slideFile].async("string");
            const textMatches = content.match(/<a:t>([^<]+)<\/a:t>/g);
            if (textMatches) {
              const texts = textMatches.map((m: string) => m.replace(/<\/?a:t>/g, ""));
              slideTexts.push(texts.join(" "));
            }
          }
          const preview = slideTexts.join("\n\n").slice(0, 32768);
          return preview.trim().length ? preview : null;
        } catch {
          return null;
        }
      }

      // XLSX extraction
      if (lower.includes("spreadsheetml") || lower.includes("excel") || name?.toLowerCase().endsWith(".xlsx") || name?.toLowerCase().endsWith(".xls")) {
        try {
          const XLSX = require("xlsx");
          const workbook = XLSX.read(buffer, { type: "buffer" });
          const sheetNames = workbook.SheetNames.slice(0, 5);
          const parts: string[] = [];
          for (const sheetName of sheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            const lines = csv.split("\n").slice(0, 50);
            parts.push(`[Sheet: ${sheetName}]\n${lines.join("\n")}`);
          }
          const preview = parts.join("\n\n").slice(0, 32768);
          return preview.trim().length ? preview : null;
        } catch {
          return null;
        }
      }

      // ZIP archive listing
      if (lower.includes("zip") || lower.includes("x-compressed") || name?.toLowerCase().endsWith(".zip")) {
        try {
          const JSZip = require("jszip");
          const zip = await JSZip.loadAsync(buffer);
          const fileList = Object.keys(zip.files).slice(0, 100);
          const preview = `[Archive contents]\n${fileList.join("\n")}`;
          return preview.slice(0, 16384);
        } catch {
          return null;
        }
      }

      // Text-like fallback (CSV, JSON, Markdown, plain text, code)
      if (
        lower.startsWith("text/") ||
        lower.includes("json") ||
        lower.includes("csv") ||
        lower.includes("markdown") ||
        lower.includes("javascript") ||
        lower.includes("typescript") ||
        lower.includes("python")
      ) {
        console.log(`[extractAttachmentContent] Attempting text extraction for ${name} (type: ${lower})`);
        const text = buffer.toString("utf-8").slice(0, 16384);
        console.log(`[extractAttachmentContent] Text extracted ${text.length} chars from ${name}`);
        return text.trim().length ? text : null;
      }

      console.warn(`[extractAttachmentContent] No handler for content type: ${lower}`);
      return null;
    } catch (err) {
      console.error(`[extractAttachmentContent] Error extracting ${name}:`, err);
      return null;
    }
  }    let expandedMessageWithAttachments = expandedMessage;
    if (attachmentLines.length) {
      expandedMessageWithAttachments += `\n\n${attachmentLines.join("\n")}`;
      // Emit a file-reading-start status for client UI
      // Note: actual streaming statuses are sent later, but we will include previews inline here.
    }

  // Upload large files to OpenAI for file_search tool
  const openaiFileIds: string[] = [];
  let vectorStoreId: string | undefined;
  
  if (Array.isArray(body.attachments) && body.attachments.length) {
    console.log(`[chatApi] Processing ${body.attachments.length} attachments`);
    // First pass: check file sizes and upload large files
    for (const att of body.attachments) {
      if (!att?.url) continue;
      
      // Check file size via HEAD request
      try {
        const headRes = await fetch(att.url, { method: "HEAD" });
        const contentLength = headRes.headers.get("content-length");
        const fileSize = contentLength ? parseInt(contentLength, 10) : 0;
        
        // If file is >100KB, upload to OpenAI for file_search
        if (fileSize > 100 * 1024) {
          try {
            // Download file
            const fileRes = await fetch(att.url);
            const fileBlob = await fileRes.blob();
            const file = new File([fileBlob], att.name || "file", { type: att.mime || "application/octet-stream" });
            
            // Upload to OpenAI
            const { OpenAI } = require("openai");
            const tempOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            
            const uploadedFile = await tempOpenAI.files.create({
              file: file,
              purpose: "assistants",
            });
            
            openaiFileIds.push(uploadedFile.id);
            console.log(`Uploaded large file to OpenAI: ${att.name} (${fileSize} bytes) -> ${uploadedFile.id}`);
          } catch (uploadErr) {
            console.error(`Failed to upload ${att.name} to OpenAI:`, uploadErr);
          }
        }
      } catch (headErr) {
        console.warn(`Failed to check size for ${att.url}:`, headErr);
      }
    }
    
    // Create vector store if we have uploaded files
    if (openaiFileIds.length > 0) {
      try {
        const { OpenAI } = require("openai");
        const tempOpenAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        
        // Check if beta API exists
        if (tempOpenAI.beta && tempOpenAI.beta.vectorStores) {
          const vectorStore = await tempOpenAI.beta.vectorStores.create({
            name: `conversation-${conversationId}-${Date.now()}`,
            file_ids: openaiFileIds,
          });
          
          vectorStoreId = vectorStore.id;
          console.log(`Created vector store ${vectorStoreId} with ${openaiFileIds.length} files`);
        } else {
          console.warn("Vector stores API not available in OpenAI SDK version");
        }
      } catch (vsErr) {
        console.error("Failed to create vector store:", vsErr);
      }
    }
    
    // Second pass: extract previews for all files
    for (const att of body.attachments) {
      if (!att?.url) continue;
      console.log(`[chatApi] Extracting content from: ${att.name} (${att.mime})`);
      const preview = await extractAttachmentContent(att.url, att.name, att.mime);
      console.log(`[chatApi] Extraction result for ${att.name}: ${preview ? preview.length + ' chars' : 'null'}`);
      if (preview) {
        const label = att.name || "attachment";
        
        // Check if this file was uploaded to OpenAI
        const headRes = await fetch(att.url, { method: "HEAD" });
        const contentLength = headRes.headers.get("content-length");
        const fileSize = contentLength ? parseInt(contentLength, 10) : 0;
        const isLargeFile = fileSize > 100 * 1024;
        
        const truncationNote = isLargeFile
          ? " [Preview truncated; full content searchable via file_search tool]"
          : "";
        
        expandedMessageWithAttachments += `\n\n[Attachment preview: ${label}${truncationNote}]\n` + preview + "\n";
        console.log(`[chatApi] Added preview for ${label}: ${preview.length} chars`);
      } else {
        console.warn(`[chatApi] No preview extracted for ${att.name}`);
      }
    }
  }

  console.log(`[chatApi] Final message length: ${expandedMessageWithAttachments.length} chars`);
  console.log(`[chatApi] Vector store ID: ${vectorStoreId || 'none'}`);

  const systemMessages = [
      {
        role: "system",
        content:
          BASE_SYSTEM_PROMPT +
          "\nYou can inline-read files when the user includes tokens like <<file:relative/path/to/file>> in their prompt. Replace those tokens with the file content and use it in your reasoning.",
        type: "message",
      },
      ...(forceWebSearch
        ? [
            {
              role: "system",
              content: FORCE_WEB_SEARCH_PROMPT,
              type: "message",
            },
          ]
        : []),
      ...(allowWebSearch && requireWebSearch && !forceWebSearch
        ? [
            {
              role: "system",
              content: EXPLICIT_WEB_SEARCH_PROMPT,
              type: "message",
            },
          ]
        : []),
    ];

    const historyMessages = (recentMessages || []).map((msg: any) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content ?? "",
      type: "message",
    }));

    const messagesForAPI = [
      ...systemMessages,
      ...historyMessages,
      {
        role: "user" as const,
        content: expandedMessageWithAttachments,
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

    const webSearchTool: WebSearchTool = { type: "web_search_preview" };
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

    const responseStream = await openai.responses.stream({
      model: modelConfig.model,
      input: messagesForAPI,
      stream: true,
      ...(toolsForRequest.length ? { tools: toolsForRequest } : {}),
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      ...(finalIncludeFields ? { include: finalIncludeFields } : {}),
      ...(modelConfig.reasoning && { reasoning: modelConfig.reasoning }),
    });
    console.log("OpenAI stream started for model:", modelConfig.model);

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
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: errorMessage,
      },
      { status: 500 }
    );
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

    const userId = getCurrentUserId();
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
