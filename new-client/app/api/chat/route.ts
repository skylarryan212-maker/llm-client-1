// Use the Node.js runtime to maximize the initial-response window for image-heavy requests
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import { supabaseServer, supabaseServerAdmin } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
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
} from "openai/resources/responses/responses";
import { calculateCost, calculateGeminiImageCost, calculateVectorStorageCost, calculateToolCallCost, CODE_INTERPRETER_SESSION_COST } from "@/lib/pricing";
import { getUserPlan } from "@/app/actions/plan-actions";
import { getMonthlySpending } from "@/app/actions/usage-actions";
import { hasExceededLimit, getPlanLimit } from "@/lib/usage-limits";
import { getRelevantMemories, type PersonalizationMemorySettings, type MemoryStrategy } from "@/lib/memory-router";
import type { MemoryItem } from "@/lib/memory";
import { writeMemory, deleteMemory } from "@/lib/memory";
import { logUsageRecord } from "@/lib/usage";
import {
  applyPermanentInstructionMutations,
  loadPermanentInstructions,
  type PermanentInstructionCacheItem,
} from "@/lib/permanentInstructions";
import type { RouterDecision } from "@/lib/router/types";
import { buildContextForMainModel } from "@/lib/context/buildContextForMainModel";
import { updateTopicSnapshot } from "@/lib/topics/updateTopicSnapshot";
import { toFile } from "openai";
import { buildOpenAIClientOptions } from "@/lib/openai/client";
import { runDecisionRouter } from "@/lib/router/decision-router";
import { runWriterRouter } from "@/lib/router/write-router";
import { runWebSearchPipeline, type WebPipelineResult } from "@/lib/search/fast-web-pipeline";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const CONTEXT_LIMIT_TOKENS = 350_000;
const MEMORY_WRITES_ENABLED = true;
const ASSISTANT_IMAGE_BUCKET = "assistant-images";
const MAX_ASSISTANT_IMAGES_PER_MESSAGE = 20;
const MAX_ASSISTANT_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const ASSISTANT_IMAGE_FETCH_TIMEOUT_MS = 8_000;
const ASSISTANT_IMAGE_MAX_REDIRECTS = 3;
const ALLOWED_ASSISTANT_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const CROSS_CHAT_TOPIC_TOKEN_LIMIT = 200_000;
const MAX_FOREIGN_CONVERSATIONS = 12;
const MAX_FOREIGN_TOPICS = 50;

function formatWebPipelineContext(result: WebPipelineResult) {
  const queriesLine = result.queries.length ? `Queries: ${result.queries.join(" | ")}` : "";
  const sources = result.sources
    .map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`)
    .join("\n");
  const chunkLines = result.chunks.map((chunk, index) => {
    const excerpt = chunk.text.length > 900 ? `${chunk.text.slice(0, 900)}...` : chunk.text;
    return `Chunk ${index + 1} (${chunk.url}): ${excerpt}`;
  });
  const evidence = chunkLines.join("\n\n");
  return [
    "Web search results (internal pipeline; do not call web_search tool):",
    queriesLine,
    sources ? `Sources:\n${sources}` : "",
    evidence ? `Evidence:\n${evidence}` : "",
  ]
    .filter((line) => line && line.trim().length > 0)
    .join("\n\n");
}

function extractPipelineDomains(result: WebPipelineResult): string[] {
  const domains = new Set<string>();
  for (const source of result.sources) {
    const domain = extractDomainFromUrl(source.url);
    if (domain) domains.add(domain);
  }
  return Array.from(domains);
}

function isPrivateIpAddress(ip: string): boolean {
  // IPv4
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  // IPv6 (basic local/link-local checks)
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("fe80:")) return true; // link-local
  return false;
}

async function assertPublicHostname(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase();
  if (!hostname) throw new Error("Invalid hostname");
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Blocked hostname");
  }
  const ipLiteral = isIP(hostname);
  if (ipLiteral) {
    if (isPrivateIpAddress(hostname)) throw new Error("Blocked private IP");
    return;
  }
  const records = await lookup(hostname, { all: true });
  for (const r of records) {
    if (r?.address && isPrivateIpAddress(r.address)) {
      throw new Error("Blocked private DNS resolution");
    }
  }
}

async function fetchWithRedirectChecks(url: URL): Promise<Response> {
  let current = url;
  for (let i = 0; i <= ASSISTANT_IMAGE_MAX_REDIRECTS; i++) {
    await assertPublicHostname(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ASSISTANT_IMAGE_FETCH_TIMEOUT_MS);
    let res: Response;
    const streamStartTimeoutMs = 20_000;
    let streamStartMs: number | null = null;
    try {
      res = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // Encourage direct image bytes (some CDNs vary responses by UA).
          "User-Agent": "llm-client/assistant-image-fetch",
          Accept: "image/*",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    // Follow redirects manually so we can re-check the destination host/IP each hop.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect without location");
      current = new URL(loc, current);
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

async function fetchImageCandidate(url: URL): Promise<Response> {
  // Retry transient errors a couple times to reduce flaky sources (e.g., Unsplash random endpoints).
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetchWithRedirectChecks(url);
    if (res.ok) return res;
    if (![429, 500, 502, 503, 504].includes(res.status) || attempt === maxAttempts) {
      return res;
    }
    // Small backoff with jitter.
    const delayMs = 150 * attempt + Math.floor(Math.random() * 150);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Unreachable, but keeps TS happy.
  return fetchWithRedirectChecks(url);
}

function extractOgImageUrl(html: string, baseUrl: URL): string | null {
  if (!html) return null;
  const candidates: Array<{ key: string; value: string }> = [];
  const metaTagRegex = /<meta\s+[^>]*>/gi;
  const attrRegex = /([a-zA-Z_:.-]+)\s*=\s*(["'])(.*?)\2/g;

  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = metaTagRegex.exec(html)) !== null) {
    const tag = tagMatch[0] ?? "";
    let property: string | null = null;
    let name: string | null = null;
    let content: string | null = null;

    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRegex.exec(tag)) !== null) {
      const k = (attrMatch[1] ?? "").toLowerCase();
      const v = (attrMatch[3] ?? "").trim();
      if (!v) continue;
      if (k === "property") property = v.toLowerCase();
      if (k === "name") name = v.toLowerCase();
      if (k === "content") content = v;
    }
    if (!content) continue;
    if (property) candidates.push({ key: property, value: content });
    if (name) candidates.push({ key: name, value: content });
  }

  const pick =
    candidates.find((c) => c.key === "og:image:secure_url") ??
    candidates.find((c) => c.key === "og:image") ??
    candidates.find((c) => c.key === "twitter:image") ??
    candidates.find((c) => c.key === "twitter:image:src");

  if (!pick?.value) return null;
  try {
    const url = new URL(pick.value, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extensionFromContentType(contentType: string): string {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

type AssistantInlineImage = { url: string; sourceUrl: string; alt?: string };

function extractInlineImagesFromContent(content: string): Array<{ sourceUrl: string; alt?: string }> {
  const out: Array<{ sourceUrl: string; alt?: string }> = [];
  if (!content) return out;

  // Preserve appearance order by scanning with a combined regex.
  const combined =
    /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+\"[^\"]*\")?\s*\)|<img\b[^>]*\bsrc=(["'])(.*?)\3[^>]*>/gim;
  let m: RegExpExecArray | null;
  while ((m = combined.exec(content)) !== null) {
    const markdownAlt = typeof m[1] === "string" ? m[1].trim() : "";
    const markdownUrl = typeof m[2] === "string" ? m[2].trim() : "";
    const htmlUrl = typeof m[4] === "string" ? m[4].trim() : "";
    const tag = m[0] ?? "";

    const sourceUrl = markdownUrl || htmlUrl;
    if (!sourceUrl) continue;
    let alt: string | undefined = markdownAlt || undefined;
    if (!alt && tag.toLowerCase().startsWith("<img")) {
      const altMatch = tag.match(/\balt=(["'])(.*?)\1/i);
      const htmlAlt = altMatch?.[2]?.trim();
      if (htmlAlt) alt = htmlAlt;
    }
    out.push({ sourceUrl, alt });
  }

  return out;
}

async function ensureAssistantImageBucket(admin: any): Promise<void> {
  const { data: list, error } = await admin.storage.listBuckets();
  if (error) throw new Error(error.message);
  const existing = (list ?? []).find((b: any) => b?.name === ASSISTANT_IMAGE_BUCKET);
  if (!existing) {
    const { error: createError } = await admin.storage.createBucket(ASSISTANT_IMAGE_BUCKET, {
      public: true,
      fileSizeLimit: MAX_ASSISTANT_IMAGE_BYTES,
    });
    if (createError) throw new Error(createError.message);
  } else if (!existing.public) {
    // Ensure the bucket is actually public so images render in chat history.
    try {
      const { error: updateError } = await admin.storage.updateBucket(ASSISTANT_IMAGE_BUCKET, {
        public: true,
        fileSizeLimit: MAX_ASSISTANT_IMAGE_BYTES,
      });
      if (updateError) throw new Error(updateError.message);
    } catch (err) {
      // If updateBucket isn't supported in this supabase-js version, surface a clearer error.
      throw new Error(
        `assistant-images bucket exists but is not public; make it public in Supabase Storage UI. (${String(
          (err as any)?.message || err
        )})`
      );
    }
  }
}

async function uploadAssistantImageFromBase64(params: {
  userId: string;
  conversationId: string;
  mimeType: string;
  base64Data: string;
}): Promise<string | null> {
  const { userId, conversationId, mimeType, base64Data } = params;
  const normalizedMime = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_ASSISTANT_IMAGE_MIME_TYPES.has(normalizedMime)) {
    console.warn("[assistant-images] Unsupported MIME type:", normalizedMime);
    return null;
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64Data, "base64");
  } catch {
    return null;
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_ASSISTANT_IMAGE_BYTES) return null;

  try {
    const admin = await supabaseServerAdmin();
    await ensureAssistantImageBucket(admin);
    const ext = extensionFromContentType(normalizedMime);
    const path = `${userId}/${conversationId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadErr } = await admin.storage
      .from(ASSISTANT_IMAGE_BUCKET)
      .upload(path, bytes, { contentType: normalizedMime, upsert: false });
    if (uploadErr) {
      console.warn("[assistant-images] Upload error:", uploadErr.message);
      return null;
    }
    const { data } = admin.storage.from(ASSISTANT_IMAGE_BUCKET).getPublicUrl(path);
    const publicUrl = typeof data?.publicUrl === "string" && data.publicUrl.length ? data.publicUrl : null;
    if (!publicUrl) {
      console.warn("[assistant-images] Missing public URL after upload:", { path });
    }
    return publicUrl;
  } catch (err) {
    console.warn(
      "[assistant-images] Failed to upload to Supabase Storage (falling back to data URL):",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

function resolveGeminiImageModel(choice: string | undefined | null): string | null {
  const normalized = String(choice ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "nano-banana") return "gemini-2.5-flash-image";
  if (normalized === "nano-banana-pro") return "gemini-3-pro-image-preview";
  if (normalized === "gemini-2.5-flash-image") return "gemini-2.5-flash-image";
  if (normalized === "gemini-3-pro-image-preview") return "gemini-3-pro-image-preview";
  return null;
}

// Kept for reference/debugging; streaming path is used in production image generation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function callGeminiGenerateContent(params: {
  apiKey: string;
  model: string;
  prompt: string;
}): Promise<{
  text: string;
  images: Array<{ mimeType: string; data: string }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
}> {
  const { apiKey, model, prompt } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const trimmed = errText.length > 400 ? `${errText.slice(0, 400)}…` : errText;
    throw new Error(`Gemini API error (${res.status}): ${trimmed || res.statusText}`);
  }

  const payload = (await res.json()) as any;
  const parts: any[] = payload?.candidates?.[0]?.content?.parts ?? [];
  const images: Array<{ mimeType: string; data: string }> = [];
  const texts: string[] = [];

  for (const part of parts) {
    const text = typeof part?.text === "string" ? part.text : null;
    if (text) texts.push(text);

    const inline = part?.inlineData ?? part?.inline_data ?? null;
    const mimeType =
      typeof inline?.mimeType === "string"
        ? inline.mimeType
        : typeof inline?.mime_type === "string"
          ? inline.mime_type
          : null;
    const data = typeof inline?.data === "string" ? inline.data : null;
    if (mimeType && data) {
      images.push({ mimeType, data });
    }
  }

  const usageMeta = payload?.usageMetadata ?? payload?.usage_metadata ?? null;
  const inputTokens =
    Number(usageMeta?.promptTokenCount ?? usageMeta?.prompt_token_count ?? 0) || 0;
  const outputTokens =
    Number(usageMeta?.candidatesTokenCount ?? usageMeta?.candidates_token_count ?? 0) || 0;
  const totalTokens =
    Number(usageMeta?.totalTokenCount ?? usageMeta?.total_token_count ?? 0) ||
    inputTokens + outputTokens;

  return {
    text: texts.filter(Boolean).join("\n\n").trim(),
    images,
    usage: usageMeta ? { inputTokens, outputTokens, totalTokens } : null,
  };
}

async function callGeminiStreamGenerateContent(params: {
  apiKey: string;
  model: string;
  prompt: string;
  onTextDelta: (delta: string) => void | Promise<void>;
}): Promise<{
  fullText: string;
  image: { mimeType: string; data: string } | null;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
}> {
  const { apiKey, model, prompt, onTextDelta } = params;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const trimmed = errText.length > 400 ? `${errText.slice(0, 400)}…` : errText;
    throw new Error(`Gemini API error (${res.status}): ${trimmed || res.statusText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Gemini streaming response had no body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let image: { mimeType: string; data: string } | null = null;
  let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null = null;

  const extractFromEvent = async (payload: any) => {
    const parts: any[] = payload?.candidates?.[0]?.content?.parts ?? [];

    // Text: sometimes streamed as cumulative, sometimes as deltas; normalize to deltas.
    const chunkText = parts
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .filter(Boolean)
      .join("");
    if (chunkText) {
      let delta = chunkText;
      if (fullText && chunkText.startsWith(fullText)) {
        delta = chunkText.slice(fullText.length);
      } else if (fullText && fullText.startsWith(chunkText)) {
        delta = "";
      }
      if (delta) {
        fullText += delta;
        await onTextDelta(delta);
      } else if (!fullText) {
        // If the first chunk is cumulative, capture it.
        fullText = chunkText;
        await onTextDelta(chunkText);
      }
    }

    // Image: usually arrives near the end
    if (!image) {
      for (const part of parts) {
        const inline = part?.inlineData ?? part?.inline_data ?? null;
        const mimeType =
          typeof inline?.mimeType === "string"
            ? inline.mimeType
            : typeof inline?.mime_type === "string"
              ? inline.mime_type
              : null;
        const data = typeof inline?.data === "string" ? inline.data : null;
        if (mimeType && data) {
          image = { mimeType, data };
          break;
        }
      }
    }

    // Usage metadata may be included in later events
    const usageMeta = payload?.usageMetadata ?? payload?.usage_metadata ?? null;
    if (usageMeta) {
      const inputTokens =
        Number(usageMeta?.promptTokenCount ?? usageMeta?.prompt_token_count ?? 0) || 0;
      const outputTokens =
        Number(usageMeta?.candidatesTokenCount ?? usageMeta?.candidates_token_count ?? 0) || 0;
      const totalTokens =
        Number(usageMeta?.totalTokenCount ?? usageMeta?.total_token_count ?? 0) ||
        inputTokens + outputTokens;
      usage = { inputTokens, outputTokens, totalTokens };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by blank lines.
      while (true) {
        const sepLf = buffer.indexOf("\n\n");
        const sepCrLf = buffer.indexOf("\r\n\r\n");
        const sep =
          sepLf !== -1 && (sepCrLf === -1 || sepLf < sepCrLf) ? sepLf : sepCrLf;
        const sepLen = sep === sepCrLf ? 4 : 2;
        if (sep === -1) break;
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + sepLen);

        const lines = rawEvent
          .split(/\r?\n/)
          .map((l) => l.trimEnd())
          .filter(Boolean);
        const dataLines = lines
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart());
        if (!dataLines.length) continue;

        const dataStr = dataLines.join("\n").trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        try {
          const payload = JSON.parse(dataStr);
          await extractFromEvent(payload);
        } catch {
          // ignore malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { fullText: fullText.trim(), image, usage };
}

async function rehostAssistantInlineImages(params: {
  userId: string;
  conversationId: string;
  content: string;
}): Promise<{
  content: string;
  images: AssistantInlineImage[];
  totalFound: number;
  totalKept: number;
}> {
  const found = extractInlineImagesFromContent(params.content);
  if (!found.length) {
    return { content: params.content, images: [], totalFound: 0, totalKept: 0 };
  }

  const totalFound = found.length;
  const kept = found.slice(0, MAX_ASSISTANT_IMAGES_PER_MESSAGE);
  const uniqueUrls: string[] = [];
  const seen = new Set<string>();
  for (const img of kept) {
    if (!img.sourceUrl) continue;
    if (seen.has(img.sourceUrl)) continue;
    seen.add(img.sourceUrl);
    uniqueUrls.push(img.sourceUrl);
  }

  let admin: any = null;
  try {
    admin = await supabaseServerAdmin();
    await ensureAssistantImageBucket(admin);
  } catch {
    admin = null;
  }

  const urlToHosted = new Map<string, string>();
  const concurrency = 4;
  let cursor = 0;

  const worker = async () => {
    while (cursor < uniqueUrls.length) {
      const idx = cursor++;
      const source = uniqueUrls[idx];
      try {
        const url = new URL(source);
        if (!/^https?:$/i.test(url.protocol)) continue;
        const res = await fetchImageCandidate(url);
        if (!res.ok) continue;

        const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        let directImageUrl: string | null = null;
        let directImageType: string | null = null;
        let directImageBytes: ArrayBuffer | null = null;

        if (ALLOWED_ASSISTANT_IMAGE_MIME_TYPES.has(contentType)) {
          directImageUrl = res.url || url.toString();
          directImageType = contentType;
          directImageBytes = await res.arrayBuffer();
        } else if (contentType.startsWith("text/html")) {
          // Try to extract an OG image and fetch that instead.
          const buf = await res.arrayBuffer();
          const slice = buf.byteLength > 512_000 ? buf.slice(0, 512_000) : buf;
          const html = new TextDecoder("utf-8").decode(slice);
          const og = extractOgImageUrl(html, url);
          if (og) {
            const ogUrl = new URL(og);
            const ogRes = await fetchImageCandidate(ogUrl);
            if (ogRes.ok) {
              const ogType = (ogRes.headers.get("content-type") || "")
                .split(";")[0]
                .trim()
                .toLowerCase();
              if (ALLOWED_ASSISTANT_IMAGE_MIME_TYPES.has(ogType)) {
                directImageUrl = ogRes.url || ogUrl.toString();
                directImageType = ogType;
                directImageBytes = await ogRes.arrayBuffer();
              }
            }
          }
        }

        if (!directImageUrl || !directImageType || !directImageBytes) continue;
        if (directImageBytes.byteLength > MAX_ASSISTANT_IMAGE_BYTES) continue;

        // Best-effort: if we can't rehost (no admin), still rewrite to the direct image URL.
        if (!admin) {
          urlToHosted.set(source, directImageUrl);
          continue;
        }

        const ext = extensionFromContentType(directImageType);
        const path = `${params.userId}/${params.conversationId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadErr } = await admin.storage
          .from(ASSISTANT_IMAGE_BUCKET)
          .upload(path, Buffer.from(directImageBytes), { contentType: directImageType, upsert: false });
        if (uploadErr) {
          urlToHosted.set(source, directImageUrl);
          continue;
        }
        const { data } = admin.storage.from(ASSISTANT_IMAGE_BUCKET).getPublicUrl(path);
        if (data?.publicUrl) urlToHosted.set(source, data.publicUrl);
      } catch {
        // Ignore individual image failures
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueUrls.length) }, worker));

  let seenIndex = 0;
  const combined =
    /!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+\"[^\"]*\")?\s*\)|<img\b[^>]*\bsrc=(["'])(.*?)\3[^>]*>/gim;
  let nextContent = params.content.replace(combined, (match, mdAlt, mdUrl, _q, htmlUrl) => {
    const currentIndex = seenIndex++;
    if (currentIndex >= MAX_ASSISTANT_IMAGES_PER_MESSAGE) return "";
    const originalUrl = String(mdUrl ?? htmlUrl ?? "").trim();
    if (!originalUrl) return match;
    const hosted = urlToHosted.get(originalUrl);
    if (!hosted) return match;
    if (typeof mdUrl === "string" && mdUrl) {
      return `![${String(mdAlt ?? "")}](${hosted})`;
    }
    // HTML <img>
    return match.replace(originalUrl, hosted);
  });
  if (totalFound > MAX_ASSISTANT_IMAGES_PER_MESSAGE) {
    nextContent += `\n\n_(Showing ${MAX_ASSISTANT_IMAGES_PER_MESSAGE} of ${totalFound} images.)_`;
  }

  const images: AssistantInlineImage[] = kept
    .map((img) => {
      const hosted = urlToHosted.get(img.sourceUrl);
      if (!hosted) return null;
      return { url: hosted, sourceUrl: img.sourceUrl, alt: img.alt };
    })
    .filter(Boolean) as AssistantInlineImage[];

  return {
    content: nextContent,
    images,
    totalFound,
    totalKept: kept.length,
  };
}

async function buildSimpleContextMessages(
  supabase: any,
  conversationId: string,
  userId: string,
  includeExternalChats: boolean,
  externalChatIds: string[] | undefined,
  maxTokens: number
): Promise<{
  messages: Array<{ role: "system" | "user" | "assistant"; content: string; type: "message" }>;
  source: "simple";
  includedTopicIds: string[];
  includedMessageIds: string[];
  summaryCount: number;
  artifactCount: number;
  debug?: {
    keptMessages: number;
    totalMessages: number;
    tokensUsed: number;
    budget: number;
    externalChatsIncluded: number;
    externalChatsConsidered: number;
    externalTokensUsed: number;
    externalChatIdsIncluded?: string[];
  };
}> {
  const { data } = await supabase
    .from("messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const rows: MessageRow[] = Array.isArray(data) ? (data as MessageRow[]) : [];
  let tokensUsed = 0;
  const selected: MessageRow[] = [];
  // Walk from newest to oldest, keeping within budget, then reverse to send oldest->newest
  for (let i = rows.length - 1; i >= 0; i--) {
    const content = rows[i].content ?? "";
    const tok = Math.max(0, estimateTokens(content));
    if (tokensUsed + tok > maxTokens) {
      continue;
    }
    tokensUsed += tok;
    selected.push(rows[i]);
  }
  selected.reverse();
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
    type: "message";
  }> = selected.map((msg) => {
    const role: "user" | "assistant" = msg.role === "assistant" ? "assistant" : "user";
    return {
      role,
      content: msg.content ?? "",
      type: "message",
    };
  });
  const includedMessageIds = selected.map((msg) => msg.id).filter((id): id is string => Boolean(id));

  let externalChatsIncluded = 0;
  let externalChatsConsidered = 0;
  let externalTokensUsed = 0;
  const externalMessageIds: string[] = [];
  const externalChatIdsIncluded: string[] = [];

  if (includeExternalChats) {
    const hasExplicitSelection = Array.isArray(externalChatIds);
    const normalizedExternalIds = hasExplicitSelection
      ? externalChatIds.filter((id) => typeof id === "string" && id && id !== conversationId)
      : [];

    // Explicit selection of zero chats means "include none".
    if (hasExplicitSelection && normalizedExternalIds.length === 0) {
      return {
        messages,
        source: "simple",
        includedTopicIds: [],
        includedMessageIds,
        summaryCount: 0,
        artifactCount: 0,
        debug: {
          keptMessages: selected.length,
          totalMessages: rows.length,
          tokensUsed,
          budget: maxTokens,
          externalChatsIncluded: 0,
          externalChatsConsidered: 0,
          externalTokensUsed: 0,
        },
      };
    }

    const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const remainingBudget = Math.max(0, maxTokens - tokensUsed);

    // Only attempt external context if there's meaningful room left.
    if (remainingBudget > 500) {
      const recentOtherMessageRowsQuery = supabase
        .from("messages")
        .select("conversation_id, created_at")
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: false })
        .limit(4000);

      const { data: recentOtherMessageRows } = hasExplicitSelection
        ? await recentOtherMessageRowsQuery.in(
            "conversation_id",
            // Keep this capped so the query stays fast even if the client sends a large list.
            normalizedExternalIds.slice(0, 200)
          )
        : await recentOtherMessageRowsQuery.neq("conversation_id", conversationId);

      const rows = Array.isArray(recentOtherMessageRows) ? recentOtherMessageRows : [];
      const mostRecentByConversation = new Map<string, string>();
      for (const row of rows) {
        const cid = (row as any).conversation_id as string | undefined;
        const createdAt = (row as any).created_at as string | undefined;
        if (!cid || !createdAt) continue;
        if (cid === conversationId) continue;
        if (!mostRecentByConversation.has(cid)) {
          mostRecentByConversation.set(cid, createdAt);
        }
      }

      const sortedConversationIds = Array.from(mostRecentByConversation.entries())
        .sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime())
        .map(([cid]) => cid);

      externalChatsConsidered = sortedConversationIds.length;

      const maxChatsToConsider = 20;
      const candidateIds = sortedConversationIds.slice(0, maxChatsToConsider);

      const { data: convoRows } = await supabase
        .from("conversations")
        .select("id, title")
        .eq("user_id", userId)
        .in("id", candidateIds);

      const titleById = new Map<string, string>();
      if (Array.isArray(convoRows)) {
        for (const row of convoRows as any[]) {
          if (row?.id) {
            titleById.set(row.id as string, (row.title as string) || "Untitled chat");
          }
        }
      }

      const blocks: string[] = [];
      for (const cid of candidateIds) {
        const lastUsedIso = mostRecentByConversation.get(cid);
        if (!lastUsedIso) continue;
        const title = titleById.get(cid) ?? "Untitled chat";

        const { data: chatMessages } = await supabase
          .from("messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", cid)
          .order("created_at", { ascending: true });

        const chatRows = Array.isArray(chatMessages) ? (chatMessages as any[]) : [];
        if (!chatRows.length) continue;

        let block = `\n=== Other chat (read-only) ===\nTitle: ${title}\nChat ID: ${cid}\nLast active: ${new Date(lastUsedIso).toISOString()}\n`;
        for (const m of chatRows) {
          if (m?.id) {
            externalMessageIds.push(String(m.id));
          }
          const role = m?.role === "assistant" ? "Assistant" : "User";
          const content = (m?.content as string) ?? "";
          if (!content.trim()) continue;
          block += `\n${role}: ${content}`;
        }
        block += "\n\n=== End other chat ===\n";

        const tok = Math.max(0, estimateTokens(block));
        if (externalTokensUsed + tok > remainingBudget) {
          // Oldest chats are at the end; stop once we can't fit the next one.
          break;
        }
        externalTokensUsed += tok;
        blocks.push(block);
        externalChatsIncluded += 1;
        externalChatIdsIncluded.push(cid);
      }

      if (blocks.length) {
        const externalIntro =
          `The following are messages from OTHER chats by the same user. ` +
          `They are provided as optional background context to help you answer. ` +
          `If the user asks about details that appear here (e.g., their name, preferences, prior decisions), ` +
          `you MAY answer using this information; when helpful, clarify that it came from another chat and ask for confirmation.\n`;

        messages.unshift({
          role: "system",
          content: externalIntro + blocks.join("\n"),
          type: "message",
        });

        tokensUsed += externalTokensUsed;
      }
    }
  }

      return {
        messages,
        source: "simple",
        includedTopicIds: [],
        includedMessageIds: [...includedMessageIds, ...externalMessageIds],
        summaryCount: 0,
        artifactCount: 0,
        debug: {
          keptMessages: selected.length,
      totalMessages: rows.length,
      tokensUsed,
      budget: maxTokens,
      externalChatsIncluded,
      externalChatsConsidered,
      externalTokensUsed,
      externalChatIdsIncluded,
    },
  };
}

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

function inferMimeFromDataUrl(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;]+);/i);
  if (!match || !match[1]) return null;
  return match[1].toLowerCase();
}

function inferMimeFromPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".md")) return "text/markdown";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".json")) return "application/json";
  return null;
}

function resolveAttachmentMime(att: { mime?: string; dataUrl?: string; url?: string; name?: string }): string | null {
  const raw = typeof att.mime === "string" ? att.mime.trim().toLowerCase() : "";
  if (raw) return raw;
  if (att.dataUrl) {
    const fromData = inferMimeFromDataUrl(att.dataUrl);
    if (fromData) return fromData;
  }
  if (att.name) {
    const fromName = inferMimeFromPath(att.name);
    if (fromName) return fromName;
  }
  if (att.url) {
    const fromUrl = inferMimeFromPath(att.url);
    if (fromUrl) return fromUrl;
  }
  return null;
}

async function loadVectorStoreIdsForMessageIds(
  supabase: any,
  messageIds: string[]
): Promise<string[]> {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return [];
  }
  const uniqueIds = Array.from(new Set(messageIds.filter(Boolean)));
  if (!uniqueIds.length) return [];
  const { data } = await supabase
    .from("messages")
    .select("id, metadata")
    .in("id", uniqueIds);
  if (!Array.isArray(data)) return [];
  const order = new Map<string, number>();
  uniqueIds.forEach((id, idx) => order.set(id, idx));
  const sorted = [...data].sort((a: any, b: any) => {
    const ai = order.get(a?.id) ?? 0;
    const bi = order.get(b?.id) ?? 0;
    return ai - bi;
  });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of sorted) {
    const meta = row?.metadata as Record<string, unknown> | null | undefined;
    const raw = meta && (meta as { vector_store_ids?: unknown }).vector_store_ids;
    if (!Array.isArray(raw)) continue;
    for (const id of raw) {
      if (typeof id !== "string") continue;
      const trimmed = id.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

async function loadImageAttachmentsForMessageIds(
  supabase: any,
  messageIds: string[],
  limit: number
): Promise<Array<{ url: string }>> {
  if (!Array.isArray(messageIds) || messageIds.length === 0 || limit <= 0) {
    return [];
  }
  const uniqueIds = Array.from(new Set(messageIds.filter(Boolean)));
  if (!uniqueIds.length) return [];
  const { data } = await supabase
    .from("messages")
    .select("id, metadata, created_at")
    .in("id", uniqueIds);
  if (!Array.isArray(data)) return [];
  const rows = [...data].sort((a: any, b: any) => {
    const at = new Date(a?.created_at || 0).getTime();
    const bt = new Date(b?.created_at || 0).getTime();
    return at - bt;
  });
  const out: Array<{ url: string }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (out.length >= limit) break;
    const meta = row?.metadata as Record<string, any> | null | undefined;
    const files: Array<{ url?: string; dataUrl?: string; mimeType?: string; name?: string }> = Array.isArray(meta?.files)
      ? meta!.files
      : [];
    for (const f of files) {
      if (out.length >= limit) break;
      const url =
        typeof f?.dataUrl === "string"
          ? f.dataUrl
          : typeof f?.url === "string"
            ? f.url
            : null;
      if (!url || seen.has(url)) continue;
      const resolvedMime = resolveAttachmentMime({
        mime: f?.mimeType,
        dataUrl: f?.dataUrl,
        url: f?.url,
        name: f?.name,
      });
      if (!resolvedMime?.startsWith("image/")) continue;
      seen.add(url);
      out.push({ url });
    }
  }
  return out;
}

async function attachmentToBuffer(att: { dataUrl?: string; url?: string; name?: string }) {
  if (att.dataUrl) return dataUrlToBuffer(att.dataUrl);
  if (att.url) {
    const res = await fetch(att.url);
    if (!res.ok) {
      throw new Error(`Failed to fetch attachment from URL (${res.status})`);
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
  return null;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  generationMode?: "chat" | "image";
  imageModel?: string;
  modelFamilyOverride?: ModelFamily;
  speedModeOverride?: SpeedMode;
  reasoningEffortOverride?: ReasoningEffort;
  speedModeEnabled?: boolean;
  forceWebSearch?: boolean;
  skipUserInsert?: boolean;
  simpleContextMode?: boolean;
  simpleContextExternalChatIds?: string[];
  advancedContextTopicIds?: string[];
  attachments?: Array<{ name?: string; mime?: string; dataUrl?: string; url?: string }>;
  location?: { lat: number; lng: number; city: string; countryCode?: string; timezone?: string };
  timezone?: string;
  clientNow?: number;
  agentId?: string | null;
  marketAgentContext?: { instanceId?: string | null; eventId?: string | null } | null;
  searchControls?: {
    sourceLimit?: number | "auto";
    excerptMode?: "snippets" | "balanced" | "rich" | "auto";
  };
}

type SearchStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-progress"; count: number }
  | { type: "search-error"; query: string; message?: string }
  | { type: "file-search-start"; query: string }
  | { type: "file-search-complete"; query: string }
  | { type: "file-reading-start" }
  | { type: "file-reading-complete" }
  | { type: "file-reading-error"; message?: string }
  | { type: "code-interpreter-start" }
  | { type: "code-interpreter-complete" }
  | { type: "code-interpreter-error"; message?: string };

type CodeInterpreterFileRef = {
  containerId: string;
  fileId: string;
  filename: string;
};

function stringifyPayloadSafe(value: unknown, max = 900): string {
  try {
    const raw = JSON.stringify(value, null, 2);
    if (!raw) return "";
    return raw.length > max ? `${raw.slice(0, max)}...` : raw;
  } catch {
    return "";
  }
}

async function loadCrossConversationTopicsForDecisionRouter(params: {
  supabase: any;
  conversationId: string;
  projectId?: string | null;
  userId?: string;
}): Promise<
  Array<{
    id: string;
    conversation_id: string;
    label: string;
    summary: string | null;
    description: string | null;
    parent_topic_id: string | null;
    conversation_title?: string | null;
    project_id?: string | null;
    is_cross_conversation?: boolean;
  }>
> {
  const { supabase, conversationId, projectId, userId } = params;
  const conversationQuery = supabase
    .from("conversations")
    .select("id, title, project_id")
    .neq("id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_FOREIGN_CONVERSATIONS);

  if (projectId) {
    conversationQuery.eq("project_id", projectId);
  }
  if (userId) {
    conversationQuery.eq("user_id", userId);
  }

  const { data: otherConversations } = await conversationQuery;
  const conversationRows = Array.isArray(otherConversations) ? otherConversations : [];
  if (!conversationRows.length) {
    return [];
  }

  const conversationMap = new Map(
    conversationRows.map((row: any) => [
      row.id,
      { title: row.title ?? null, project_id: row.project_id ?? null },
    ])
  );
  const conversationIds = Array.from(conversationMap.keys());

  const { data: topicRows } = await supabase
    .from("conversation_topics")
    .select("id, conversation_id, label, summary, description, parent_topic_id, token_estimate, updated_at")
    .in("conversation_id", conversationIds)
    .lte("token_estimate", CROSS_CHAT_TOPIC_TOKEN_LIMIT)
    .order("updated_at", { ascending: false })
    .limit(MAX_FOREIGN_TOPICS);

  if (!Array.isArray(topicRows)) {
    return [];
  }

  return topicRows.map((topic: any) => ({
    id: topic.id,
    conversation_id: topic.conversation_id,
    label: topic.label,
    summary: topic.summary,
    description: topic.description,
    parent_topic_id: topic.parent_topic_id,
    conversation_title: conversationMap.get(topic.conversation_id)?.title ?? null,
    project_id: conversationMap.get(topic.conversation_id)?.project_id ?? null,
    is_cross_conversation: true,
  }));
}

function summarizeMarketState(state: any): string | null {
  if (!state || typeof state !== "object") return null;
  const parts: string[] = [];
  if (typeof state.assessment === "string") parts.push(`Assessment: ${state.assessment}`);
  if (typeof state.regime === "string") parts.push(`Regime: ${state.regime}`);
  if (typeof state.bias === "string") parts.push(`Bias: ${state.bias}`);
  if (Array.isArray(state.alerts) && state.alerts.length) parts.push(`Alerts: ${state.alerts.join(", ")}`);
  if (typeof state.note === "string") parts.push(`Note: ${state.note}`);
  return parts.length ? parts.join(" | ") : null;
}

function extractCodeInterpreterFilesFromOutput(output: any): CodeInterpreterFileRef[] {
  if (!Array.isArray(output)) return [];
  const results: CodeInterpreterFileRef[] = [];
  const seen = new Set<string>();

  const visitAnnotations = (annotations: any) => {
    if (!Array.isArray(annotations)) return;
    for (const ann of annotations) {
      if (!ann || ann.type !== "container_file_citation") continue;
      const containerId = typeof ann.container_id === "string" ? ann.container_id : null;
      const fileId = typeof ann.file_id === "string" ? ann.file_id : null;
      const filename = typeof ann.filename === "string" ? ann.filename : null;
      if (!containerId || !fileId || !filename) continue;
      const key = `${containerId}:${fileId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ containerId, fileId, filename });
    }
  };

  for (const item of output) {
    if (!item) continue;
    // Most commonly: { type: "message", content: [{ annotations: [...] }, ...] }
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        visitAnnotations(part?.annotations);
      }
    }
    // Sometimes nested annotations
    visitAnnotations((item as any)?.annotations);
  }

  return results;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteCodeInterpreterDownloadLinks(options: {
  content: string;
  messageId: string;
  files: CodeInterpreterFileRef[];
}): string {
  const { content, messageId, files } = options;
  if (!content || !messageId || !Array.isArray(files) || files.length === 0) return content;

  let updated = content;

  for (const file of files) {
    if (!file?.filename || !file?.containerId || !file?.fileId) continue;
    const downloadUrl = `/api/code-interpreter/download?messageId=${encodeURIComponent(
      messageId
    )}&containerId=${encodeURIComponent(file.containerId)}&fileId=${encodeURIComponent(file.fileId)}`;

    const raw = file.filename;
    const encoded = encodeURIComponent(raw);
    const candidates = new Set<string>([
      `sandbox:/mnt/data/${raw}`,
      `sandbox:///mnt/data/${raw}`,
      `/mnt/data/${raw}`,
      `mnt/data/${raw}`,
      `./mnt/data/${raw}`,
      `sandbox:/mnt/data/${encoded}`,
      `sandbox:///mnt/data/${encoded}`,
      `/mnt/data/${encoded}`,
      `mnt/data/${encoded}`,
      `./mnt/data/${encoded}`,
    ]);

    for (const candidate of candidates) {
      if (updated.includes(candidate)) {
        updated = updated.split(candidate).join(downloadUrl);
      }
    }

    // Also catch any scheme variations that still end with the filename.
    const filenamePattern = escapeRegExp(raw);
    const schemeRegex = new RegExp(
      String.raw`(?:sandbox:\/+)?(?:\.\/*)?\/?mnt\/data\/${filenamePattern}`,
      "gi"
    );
    updated = updated.replace(schemeRegex, downloadUrl);
  }

  return updated;
}

function extractContainerIdFromCiEvent(event: any): string | null {
  if (!event || typeof event !== "object") return null;
  const candidates = [
    (event as any).container_id,
    (event as any).containerId,
    (event as any)?.item?.container_id,
    (event as any)?.item?.containerId,
    (event as any)?.code_interpreter_call?.container_id,
    (event as any)?.code_interpreter_call?.containerId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}


function getApproximateLocationFromHeaders(
  request: NextRequest
): {
  location: { lat: number; lng: number; city: string; countryCode?: string; timezone?: string } | null;
  timezone: string | null;
} {
  const headers = request.headers;
  const cityHeader = headers.get("x-vercel-ip-city") || headers.get("cf-ipcity") || "";
  const regionHeader = headers.get("x-vercel-ip-country-region") || headers.get("cf-region") || "";
  const countryHeader = headers.get("x-vercel-ip-country") || headers.get("cf-ipcountry") || "";
  const timezoneHeader = headers.get("x-vercel-ip-timezone") || headers.get("cf-timezone") || null;
  const latStr = headers.get("x-vercel-ip-latitude") || headers.get("cf-iplatitude");
  const lngStr = headers.get("x-vercel-ip-longitude") || headers.get("cf-iplongitude");

  const lat = latStr ? parseFloat(latStr) : NaN;
  const lng = lngStr ? parseFloat(lngStr) : NaN;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

  const labelParts = [cityHeader, regionHeader, countryHeader].filter(Boolean);
  const cityLabel = labelParts.join(", ") || (hasCoords ? `${lat.toFixed(2)}, ${lng.toFixed(2)}` : "");

  const location =
    hasCoords && cityLabel
      ? {
          lat,
          lng,
          city: cityLabel,
          countryCode: countryHeader || undefined,
          timezone: timezoneHeader || undefined,
        }
      : null;

  return { location, timezone: timezoneHeader };
}

function extractKeywords(text: string, topicLabel?: string | null): string[] {
  const STOP = new Set([
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "have",
    "from",
    "into",
    "about",
    "your",
    "you",
    "are",
    "was",
    "were",
    "will",
    "would",
    "shall",
    "should",
    "could",
    "there",
    "here",
    "they",
    "them",
    "their",
    "our",
    "ours",
    "has",
    "had",
    "can",
    "but",
    "not",
    "just",
    "like",
    "then",
    "than",
    "when",
    "what",
    "why",
    "how",
    "who",
    "where",
    "which",
    "also",
    "into",
    "within",
  ]);

  const base = [text || "", topicLabel || ""]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
  const freq = new Map<string, number>();
  for (const token of base.split(/\s+/)) {
    if (!token || token.length < 3 || token.length > 24) continue;
    if (STOP.has(token)) continue;
    freq.set(token, (freq.get(token) ?? 0) + 1);
  }

  const sorted = Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k]) => k);

  return sorted;
}

function buildAutoTopicLabel(message: string): string {
  const clean = (message || "").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").slice(0, 5);
  const label = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
  return label || "New Topic";
}

function buildAutoTopicDescription(message: string): string | null {
  const clean = (message || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean;
}

function buildAutoTopicSummary(message: string): string | null {
  const clean = (message || "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 240 ? `${clean.slice(0, 240)}…` : clean;
}

const BASE_SYSTEM_PROMPT =
  "# Identity\\n" +
  "You are a helpful, web-connected assistant. Follow the user instructions.\\n\\n" +
  "# Memory\\n" +
  "Saved memories (if provided) can be used for personalization. Answer based only on listed memories; don't invent or mention that you're using them.\\n\\n" +
  "# Web Use & Citations\\n" +
  "When you rely on live search results, add an inline markdown link right after each factual claim: [source-name](https://full-url.com). Do not add a sources list. If search results are weak, say so before relying on older knowledge.\\n\\n" +
  "# General\\n" +
  "Avoid hallucinating details. Ask clarifying questions when unsure. When listing prior user prompts, include only their typed text (not file contents or attachment names).";

function stripMemoryBehaviorBlock(prompt: string): string {
  const start = prompt.indexOf("**Memory Behavior:**");
  if (start === -1) return prompt;
  const end = prompt.indexOf("**Web Search Rules:**");
  if (end === -1 || end <= start) return prompt;
  const before = prompt.slice(0, start).trimEnd();
  const after = prompt.slice(end);
  return `${before}\n\n${after}`;
}

async function loadPersonalizationSettingsServer(
  userId: string
): Promise<PersonalizationMemorySettings & { customInstructions?: string; baseStyle?: string; referenceChatHistory?: boolean }> {
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase
      .from("user_preferences")
      .select("base_style, custom_instructions, reference_saved_memories, reference_chat_history, allow_saving_memory")
      .eq("user_id", userId)
      .maybeSingle<any>();

    return {
      referenceSavedMemories: data?.reference_saved_memories ?? true,
      allowSavingMemory: data?.allow_saving_memory ?? true,
      referenceChatHistory: data?.reference_chat_history ?? true,
      customInstructions: data?.custom_instructions || "",
      baseStyle: data?.base_style || "Professional",
    };
  } catch {
    return { referenceSavedMemories: true, allowSavingMemory: true, referenceChatHistory: true };
  }
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
      Professional: `STYLE PRESET: Professional
- Tone: formal, neutral, businesslike.
- Language: complete sentences; avoid slang; avoid filler; avoid emojis.
- Structure: start with the direct answer, then short supporting details. Use headings only if needed.
- Do not: chatty banter, jokes, excessive enthusiasm, or casual asides.`,
      Friendly: `STYLE PRESET: Friendly
- Tone: warm, supportive, personable (but not dramatic).
- Language: simple and conversational; gentle phrasing; acknowledge the user’s intent briefly.
- Structure: answer directly, then offer 1 helpful next step or 1 clarifying question if needed.
- Do not: emojis, overly formal wording, or robotic phrasing.`,
      Concise: `STYLE PRESET: Concise
- Output length: keep it short; default to 1–3 sentences.
- Structure: answer-first. No preamble. No recap. No extra tips unless asked.
- Formatting: avoid lists unless the user explicitly asks for options or steps.
- Do not: filler, hedging, long explanations, or multiple follow-up questions.`,
      Creative: `STYLE PRESET: Creative
- Tone: imaginative, vivid, and engaging (still accurate).
- Language: use evocative phrasing, metaphors, and varied sentence rhythm when appropriate.
- Structure: answer the request, then optionally add 1–2 creative variations or ideas.
- Do not: dry corporate tone, unnecessary disclaimers, or generic “here are options” boilerplate.`,
      Robot: `STYLE PRESET: Robot
- Tone: emotionless, expressionless, direct, efficient.
- Language: no niceties; no enthusiasm; no empathy phrasing; no exclamation points; avoid contractions.
- Structure: answer-only. Prefer 1–2 short sentences. No “quick options” or suggestions unless asked.
- Formatting: avoid lists unless the user explicitly requests a list.
- Do not: greetings, sign-offs, jokes, or small talk.`,
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

type TextVerbosity = "low" | "medium" | "high";

function getStyleTuning(baseStyle?: string): {
  textVerbosity?: TextVerbosity;
  temperature?: number;
} {
  switch (baseStyle) {
    case "Concise":
      return { textVerbosity: "low", temperature: 0.2 };
    case "Robot":
      return { textVerbosity: "low", temperature: 0.1 };
    case "Professional":
      return { textVerbosity: "low", temperature: 0.2 };
    case "Friendly":
      return { textVerbosity: "medium", temperature: 0.7 };
    case "Creative":
      return { textVerbosity: "high", temperature: 1.1 };
    default:
      return { textVerbosity: "medium", temperature: 0.8 };
  }
}

const FORCE_WEB_SEARCH_PROMPT =
  "The user explicitly requested live web search. Ensure you call the `web_search` tool for this turn unless it would clearly be redundant.";

const EXPLICIT_WEB_SEARCH_PROMPT =
  "The user asked for live sources or links. You must call the `web_search` tool, base your answer on those results, and cite them using markdown links [text](url). Do not fabricate sources. Every factual claim must include an inline citation immediately after the claim.";

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
  const requestStartMs = Date.now();
  try {
    const body = (await request.json()) as ChatRequestBody;
    console.log("[chatApi] POST received", {
      conversationId: body.conversationId,
      projectId: body.projectId,
      messagePreview: typeof body.message === 'string' ? body.message.slice(0,80) : null,
      generationMode: body.generationMode ?? "chat",
      imageModel: body.imageModel ?? null,
      skipUserInsert: body.skipUserInsert,
      timestamp: Date.now(),
    });
	    const {
	      conversationId,
	      projectId,
	      message,
        generationMode = "chat",
        imageModel,
	      modelFamilyOverride,
        speedModeOverride,
        reasoningEffortOverride,
        speedModeEnabled = false,
        skipUserInsert,
        forceWebSearch = false,
        attachments,
        location,
        timezone,
        clientNow,
        simpleContextMode = false,
        simpleContextExternalChatIds,
        advancedContextTopicIds,
        agentId = null,
        marketAgentContext = null,
        searchControls,
    } = body;
    const headerGeo = getApproximateLocationFromHeaders(request);
    const effectiveLocation = location ?? headerGeo.location ?? null;
    const effectiveTimezone = timezone ?? location?.timezone ?? headerGeo.timezone ?? null;
    const useCustomWebSearch = process.env.USE_BRIGHTDATA_WEB_SEARCH !== "0";
    const trimmedMessage = message?.trim() ?? "";
    let customWebSearchResult: WebPipelineResult | null = null;
    let customWebSearchInput:
      | {
          prompt: string;
          recentMessages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
          currentDate: string;
          location?: { city?: string; countryCode?: string; languageCode?: string };
          preferredSourceUrls?: string[];
          searchControls?: {
            sourceLimit?: number | "auto";
            excerptMode?: "snippets" | "balanced" | "rich" | "auto";
          };
        }
      | null = null;
    const nowForSearch = typeof clientNow === "string" || typeof clientNow === "number"
      ? new Date(clientNow)
      : new Date();
    const currentDateForSearch = (() => {
      try {
        if (effectiveTimezone) {
          return new Intl.DateTimeFormat("en-CA", {
            timeZone: effectiveTimezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(nowForSearch);
        }
      } catch {
        // fall through
      }
      return nowForSearch.toISOString().slice(0, 10);
    })();

    const extractReasoningText = (reasoning: any): string => {
      if (!reasoning) return "";
      if (typeof reasoning === "string") return reasoning;
      if (typeof reasoning?.output_text === "string") return reasoning.output_text;
      if (Array.isArray(reasoning?.summary)) {
        return reasoning.summary
          .map((s: any) => {
            if (typeof s?.text === "string") return s.text;
            if (typeof s?.content === "string") return s.content;
            return "";
          })
          .filter(Boolean)
          .join("\n\n");
      }
      if (Array.isArray(reasoning?.content)) {
        return reasoning.content
          .map((c: any) => {
            if (typeof c?.text === "string") return c.text;
            if (typeof c?.content === "string") return c.content;
            return "";
          })
          .filter(Boolean)
          .join("\n\n");
      }
      if (typeof reasoning?.text === "string") return reasoning.text;
      return "";
    };

    const extractReasoningFromOutput = (output: any): string => {
      if (!Array.isArray(output)) return "";
      return output
        .filter((item) => item && item.type === "reasoning")
        .map((item) => extractReasoningText(item))
        .filter(Boolean)
        .join("\n\n");
    };

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
    const personalizationSettingsPromise = loadPersonalizationSettingsServer(userId);

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
    const forceSpeedMode = Boolean(speedModeEnabled);
    const speedMode = normalizeSpeedMode(speedModeOverride ?? "auto");
    const reasoningEffortHint = reasoningEffortOverride;
    if (forceSpeedMode && modelFamily === "auto") {
      modelFamily = "gpt-5-nano";
    }
    
    // Progressive model restrictions based on usage percentage
    if (usagePercentage >= 95) {
      // At 95%+: Only allow Nano
      if (modelFamily !== "gpt-5-nano") {
        console.log(`[usageLimit] User at ${usagePercentage.toFixed(1)}% usage - forcing Nano model`);
        modelFamily = "gpt-5-nano";
      }
    } else if (usagePercentage >= 90) {
      // At 90-95%: Disable GPT 5.2, allow Mini and Nano
      if (modelFamily === "gpt-5.2") {
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

    const effectiveSimpleContextMode = forceSpeedMode ? true : simpleContextMode;
    const effectiveAdvancedContextTopicIds = forceSpeedMode ? [] : advancedContextTopicIds;

    // Kick off simple context in parallel (only needs personalization + supabase + user/conversation ids)
    const simpleContextPromise =
      effectiveSimpleContextMode && personalizationSettingsPromise
        ? (async () => {
            const personalizationSettings = await personalizationSettingsPromise;
            const normalizedExternalChatIds = Array.isArray(simpleContextExternalChatIds)
              ? simpleContextExternalChatIds.filter((id) => typeof id === "string")
              : undefined;
            const includeExternalChats = false;
            return buildSimpleContextMessages(
              supabaseAny,
              conversationId,
              userId,
              includeExternalChats && Boolean(personalizationSettings?.referenceChatHistory),
              normalizedExternalChatIds,
              CONTEXT_LIMIT_TOKENS
            );
          })()
        : null;

    const conversation = conversationData as ConversationRow;
    const abortSignal = request.signal;
    const removeAssistantPlaceholder = async () => {
      if (!assistantMessageRow) return;
      try {
        await supabaseAny.from("messages").delete().eq("id", assistantMessageRow.id);
      } catch (err) {
        console.error("[chatApi] Failed to delete aborted assistant placeholder:", err);
      }
      assistantMessageRow = null;
    };
    const exitIfAborted = async () => {
      if (!abortSignal.aborted) return false;
      await removeAssistantPlaceholder();
      return true;
    };

    let projectMeta: { id: string; name: string | null } | null = null;
    if (conversation.project_id) {
      const { data: projectRow } = await supabaseAny
        .from("projects")
        .select("id, name")
        .eq("id", conversation.project_id)
        .maybeSingle();
      if (projectRow) {
        projectMeta = { id: projectRow.id, name: projectRow.name };
      }
    }

    // Validate projectId if provided
    if (projectId && conversation.project_id !== projectId) {
      return NextResponse.json(
        { error: "Project ID mismatch" },
        { status: 400 }
      );
    }

    // Conversation metadata (used for CI sessions and vector store).
    let conversationMetadata: any =
      conversation.metadata && typeof conversation.metadata === "object" ? (conversation.metadata as any) : {};
    if (agentId === "market-agent" && marketAgentContext?.instanceId) {
      const nextMeta = {
        ...conversationMetadata,
        agent: "market-agent",
        agent_type: "market_agent",
        market_agent_instance_id: marketAgentContext.instanceId,
        agent_chat: true,
      };
      if (JSON.stringify(nextMeta) !== JSON.stringify(conversationMetadata)) {
        const { error: convMetaErr } = await supabaseAny
          .from("conversations")
          .update({ metadata: nextMeta })
          .eq("id", conversationId)
          .eq("user_id", userId);
        if (!convMetaErr) {
          conversationMetadata = nextMeta;
        }
      }
    }
    const ciMeta = conversationMetadata.codeInterpreter && typeof conversationMetadata.codeInterpreter === "object"
      ? conversationMetadata.codeInterpreter
      : {};
    const configuredCiContainerId =
      typeof ciMeta.containerId === "string" && ciMeta.containerId.trim().length > 0
        ? ciMeta.containerId.trim()
        : null;
    const billedCiContainerIds: string[] = Array.isArray(ciMeta.billedContainerIds)
      ? ciMeta.billedContainerIds.filter((id: any) => typeof id === "string" && id.trim().length > 0).map((id: string) => id.trim())
      : [];

    // Load last few messages to check for OpenAI response ID (for context chaining)
    const { data: recentMessagesRaw, error: messagesError } = await supabaseAny
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(6);

    if (messagesError) {
      console.error("Failed to load messages:", messagesError);
      return NextResponse.json(
        { error: "Failed to load conversation history" },
        { status: 500 }
      );
    }

    // Normalize to the six most recent messages in chronological order for router context.
    const recentMessages: MessageRow[] = Array.isArray(recentMessagesRaw)
      ? [...recentMessagesRaw].sort(
          (a: MessageRow, b: MessageRow) =>
            new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        )
      : [];

    // Load topics for this conversation (used by decision router)
    const { data: topicRows } = await supabaseAny
      .from("conversation_topics")
      .select("id, conversation_id, label, summary, description, parent_topic_id")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(50);
    const baseTopicsForRouter = Array.isArray(topicRows)
      ? topicRows.map((t: any) => ({
          id: t.id,
          conversation_id: t.conversation_id,
          label: t.label,
          summary: t.summary,
          description: t.description,
          parent_topic_id: t.parent_topic_id,
          conversation_title: conversation.title ?? null,
          project_id: conversation.project_id ?? null,
          is_cross_conversation: false,
        }))
      : [];
    const crossChatTopicsForRouter = effectiveSimpleContextMode
      ? []
      : await loadCrossConversationTopicsForDecisionRouter({
          supabase: supabaseAny,
          conversationId,
          projectId: conversation.project_id ?? null,
          userId,
        });
    const topicsForRouter = effectiveSimpleContextMode
      ? baseTopicsForRouter
      : [...baseTopicsForRouter, ...crossChatTopicsForRouter];

    // Load artifacts for this conversation (used by decision router)
    const { data: artifactRows } = await supabaseAny
      .from("artifacts")
      .select("id, conversation_id, topic_id, type, title, summary, keywords")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(50);
    const artifactsForRouter =
      Array.isArray(artifactRows) &&
      artifactRows.map((a: any) => ({
        id: a.id,
        conversation_id: a.conversation_id,
        topic_id: a.topic_id,
        type: a.type,
        title: a.title,
        summary: a.summary,
        keywords: Array.isArray(a.keywords) ? a.keywords : [],
        snippet: typeof a.summary === "string" ? a.summary.slice(0, 200) : "",
      }));

    // Optionally insert the user message unless the client indicates it's already persisted (e.g., first send via server action, or retry)
    const buildUserMetadata = () => {
      const meta: Record<string, unknown> = {};
      if (attachments && attachments.length) {
        meta.files = attachments.map((a) => ({
          name: a.name,
          mimeType: a.mime,
          url: a.url,
        }));
      }
      if (agentId) {
        meta.agent = agentId;
      }
      if (marketAgentContext?.instanceId) {
        meta.market_agent_instance_id = marketAgentContext.instanceId;
      }
      if (marketAgentContext?.eventId) {
        meta.related_market_event_id = marketAgentContext.eventId;
      }
      return meta;
    };

    let userMessageRow: MessageRow | null = null;
    let permanentInstructionState: { instructions: PermanentInstructionCacheItem[]; metadata: ConversationRow["metadata"] } | null = null;
    if (!skipUserInsert) {
      const insertResult = await supabaseAny
        .from("messages")
        .insert({
          user_id: userId,
          conversation_id: conversationId,
          role: "user",
          content: message,
          metadata: buildUserMetadata(),
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
          ...buildUserMetadata(),
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

    // Exclude the current user prompt from router contexts to avoid duplication.
      const recentMessagesForRouting: MessageRow[] = Array.isArray(recentMessages)
        ? recentMessages.filter((m: MessageRow) => m.id !== userMessageRow?.id)
        : [];

      if (useCustomWebSearch && trimmedMessage) {
        const recentMessagesForSearch = (recentMessagesForRouting || [])
          .slice(-6)
          .map((m: any) => ({
            role: (m.role as "user" | "assistant" | "system") ?? "user",
            content: m.content ?? "",
          }));
        const acceptLanguage = request.headers.get("accept-language") || "";
        const primaryLang = acceptLanguage.split(",")[0]?.split("-")[0]?.toLowerCase() || "en";
        const countryCode =
          effectiveLocation?.countryCode?.toLowerCase() ||
          headerGeo.location?.countryCode?.toLowerCase() ||
          (request.headers.get("x-vercel-ip-country") || request.headers.get("cf-ipcountry") || "").toLowerCase() ||
          undefined;
        let preferredSourceUrls: string[] = [];
        const { data: lastAssistantMeta } = await supabaseAny
          .from("messages")
          .select("metadata")
          .eq("conversation_id", conversationId)
          .eq("role", "assistant")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const lastMeta = (lastAssistantMeta?.metadata || null) as AssistantMessageMetadata | null;
        if (lastMeta?.webSearchSources && Array.isArray(lastMeta.webSearchSources)) {
          const seen = new Set<string>();
          preferredSourceUrls = lastMeta.webSearchSources
            .map((s) => (typeof s?.url === "string" ? s.url.trim() : ""))
            .filter((u) => {
              if (!u) return false;
              const key = u.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
        }
        customWebSearchInput = {
          prompt: trimmedMessage,
          recentMessages: recentMessagesForSearch,
          currentDate: currentDateForSearch,
          location: {
            city: effectiveLocation?.city,
            countryCode: countryCode ? countryCode.toLowerCase() : undefined,
            languageCode: primaryLang || undefined,
          },
          preferredSourceUrls,
          searchControls,
        };
      }

      const resolvedMarketInstanceId =
        (marketAgentContext as any)?.instanceId ??
      ((userMessageRow?.metadata as any)?.market_agent_instance_id as string | null) ??
      (conversationMetadata && typeof conversationMetadata.market_agent_instance_id === "string"
        ? (conversationMetadata.market_agent_instance_id as string)
        : null);
    const resolvedMarketEventId =
      (marketAgentContext as any)?.eventId ??
      ((userMessageRow?.metadata as any)?.related_market_event_id as string | null) ??
      null;
    const marketContextMessages: Array<{ role: "system"; content: string }> = [];

    if (resolvedMarketInstanceId) {
      const { data: instanceRow } = await supabaseAny
        .from("market_agent_instances")
        .select("*")
        .eq("id", resolvedMarketInstanceId)
        .maybeSingle();
      const { data: watchlistRows } = await supabaseAny
        .from("market_agent_watchlist_items")
        .select("symbol")
        .eq("instance_id", resolvedMarketInstanceId);
      const watchlistSymbols = Array.isArray(watchlistRows)
        ? (watchlistRows as any[]).map((row) => row.symbol).filter(Boolean)
        : [];

      if (instanceRow) {
        const cadenceLabel =
          instanceRow.cadence_seconds && instanceRow.cadence_seconds >= 60
            ? `${Math.round(instanceRow.cadence_seconds / 60)}m`
            : `${instanceRow.cadence_seconds}s`;
        marketContextMessages.push({
          role: "system",
          content: `Market Agent instance ${instanceRow.label || resolvedMarketInstanceId} (status: ${instanceRow.status}, cadence: ${cadenceLabel}). Watchlist: ${
            watchlistSymbols.length ? watchlistSymbols.join(", ") : "none"
          }.`,
        });
      }

      let marketEventRow: any = null;
      if (resolvedMarketEventId) {
        const { data: eventRow } = await supabaseAny
          .from("market_agent_events")
          .select("*")
          .eq("id", resolvedMarketEventId)
          .maybeSingle();
        marketEventRow = eventRow;
      } else {
        const { data: eventRow } = await supabaseAny
          .from("market_agent_events")
          .select("*")
          .eq("instance_id", resolvedMarketInstanceId)
          .order("ts", { ascending: false })
          .limit(1)
          .maybeSingle();
        marketEventRow = eventRow;
      }
      if (marketEventRow) {
        const payloadSnippet = stringifyPayloadSafe((marketEventRow as any).payload, 900);
        marketContextMessages.push({
          role: "system",
          content: `Latest market report (${marketEventRow.ts ?? marketEventRow.created_at ?? "recent"} | severity: ${
            marketEventRow.severity
          }): ${marketEventRow.summary || "No summary provided."}${payloadSnippet ? `\nDetails: ${payloadSnippet}` : ""}`,
        });
      }

      const { data: stateRow } = await supabaseAny
        .from("market_agent_state")
        .select("*")
        .eq("instance_id", resolvedMarketInstanceId)
        .maybeSingle();
      if (stateRow?.state) {
        const stateText = summarizeMarketState(stateRow.state) ?? stringifyPayloadSafe(stateRow.state, 800);
        if (stateText) {
          marketContextMessages.push({
            role: "system",
            content: `Current agent state: ${stateText}`,
          });
        }
      }
    }

    if (generationMode === "image") {
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          { error: "Missing image API key (set GOOGLE_API_KEY or GEMINI_API_KEY)" },
          { status: 500 }
        );
      }

      const resolvedModel = resolveGeminiImageModel(imageModel);
      if (!resolvedModel) {
        return NextResponse.json(
          {
            error: "Invalid image model",
            details: 'Use imageModel "nano-banana" or "nano-banana-pro".',
          },
          { status: 400 }
        );
      }

      console.log("[gemini-image] Starting", {
        model: resolvedModel,
        choice: imageModel ?? null,
        conversationId,
        userId,
      });

      const encoder = new TextEncoder();
      const requestStartMs = Date.now();

      const readableStream = new ReadableStream({
        async start(controller) {
          const enqueueJson = (obj: Record<string, unknown>) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

          try {
            const result = await callGeminiStreamGenerateContent({
              apiKey,
              model: resolvedModel,
              prompt: message,
              onTextDelta: async (delta) => {
                if (!delta) return;
                enqueueJson({ token: delta });
              },
            });

            const firstImage = result.image;
            console.log("[gemini-image] Model response received", {
              model: resolvedModel,
              textChars: result.fullText?.length ?? 0,
              mimeType: firstImage?.mimeType ?? null,
              imageBase64Chars: firstImage?.data?.length ?? 0,
            });
            if (!firstImage?.data || !firstImage?.mimeType) {
              console.warn("[gemini-image] No image part returned from Gemini", {
                model: resolvedModel,
                choice: imageModel ?? null,
              });
              enqueueJson({ error: "Gemini did not return an image for this prompt." });
              enqueueJson({ done: true });
              controller.close();
              return;
            }

            const hostedUrl =
              (await uploadAssistantImageFromBase64({
                userId,
                conversationId,
                mimeType: firstImage.mimeType,
                base64Data: firstImage.data,
              })) ??
              `data:${firstImage.mimeType};base64,${firstImage.data}`;

            if (hostedUrl.startsWith("data:")) {
              console.warn("[gemini-image] Using data URL fallback (not stored in Supabase Storage)");
            } else {
              console.log("[gemini-image] Image stored in Supabase Storage");
            }

            // Emit only the image Markdown at the end (text already streamed above).
            enqueueJson({ token: `\n\n![Generated image](${hostedUrl})` });

            const assistantContent = [result.fullText?.trim() ? result.fullText.trim() : null, `![Generated image](${hostedUrl})`]
              .filter(Boolean)
              .join("\n\n");

            const thinkingDurationMs = Math.max(Date.now() - requestStartMs, 0);
            const metadataPayload = buildAssistantMetadataPayload({
              base: {
                modelUsed: resolvedModel,
                reasoningEffort: "none",
                resolvedFamily: resolvedModel,
                speedModeUsed: "auto",
                userRequestedFamily: "auto",
                userRequestedSpeedMode: "auto",
                userRequestedReasoningEffort: undefined,
                routedBy: "code",
              },
              content: assistantContent,
              thinkingDurationMs,
            });
            (metadataPayload as any).imageGeneration = {
              provider: "gemini",
              model: resolvedModel,
              choice: imageModel ?? null,
            };
            // Image generations should not show "Sources" (the image URL is our own hosted asset).
            (metadataPayload as any).citations = [];
            (metadataPayload as any).searchedDomains = [];
            delete (metadataPayload as any).searchedSiteLabel;

            let assistantMessageRow: MessageRow | null = null;
            try {
              const { data: insertedRow, error: assistantError } = await supabaseAny
                .from("messages")
                .insert({
                  user_id: userId,
                  conversation_id: conversationId,
                  role: "assistant",
                  content: assistantContent,
                  openai_response_id: null,
                  metadata: metadataPayload,
                  preamble: null,
                  topic_id: null,
                })
                .select()
                .single();

              if (assistantError || !insertedRow) {
                console.error("[gemini-image] Failed to save assistant message:", assistantError);
              } else {
                assistantMessageRow = insertedRow as MessageRow;
              }
            } catch (persistErr) {
              console.error("[gemini-image] Failed to persist assistant message:", persistErr);
            }

            try {
              const inputTokens = result.usage?.inputTokens ?? 0;
              const outputTokens = result.usage?.outputTokens ?? 0;
              const estimatedCost = calculateGeminiImageCost(resolvedModel, inputTokens, 1);
              await logUsageRecord({
                userId,
                conversationId,
                model: resolvedModel,
                inputTokens,
                cachedTokens: 0,
                outputTokens,
                estimatedCost,
              });
              console.log(
                `[usage] Logged Gemini image model=${resolvedModel} input=${inputTokens} output=${outputTokens} cost=$${estimatedCost.toFixed(6)}`
              );
            } catch (usageErr) {
              console.error("[usage] Failed to log Gemini image usage:", usageErr);
            }

            enqueueJson({
              meta: {
                assistantMessageRowId: assistantMessageRow?.id ?? `error-${Date.now()}`,
                userMessageRowId: userMessageRow?.id,
                model: resolvedModel,
                reasoningEffort: "none",
                resolvedFamily: resolvedModel,
                speedModeUsed: "auto",
                finalContent: assistantContent,
                metadata: metadataPayload,
              },
            });

            enqueueJson({ done: true });
          } catch (error) {
            console.error("[gemini-image] Stream error:", error);
            enqueueJson({ error: error instanceof Error ? error.message : String(error) });
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

    try {
      permanentInstructionState = await loadPermanentInstructions({
        supabase: supabaseAny,
        userId,
        conversationId,
        conversation,
        forceRefresh: false,
      });
    } catch (permInitErr) {
      console.error("[permanent-instructions] Failed to preload instructions:", permInitErr);
    }

    let memoriesForDecision: Array<{ id: string; type: string; title: string; content: string }> = [];
    if (userId) {
      try {
        const { data: memRows } = await supabaseAny
          .from("memories")
          .select("id, type, title, content")
          .eq("user_id", userId)
          .eq("enabled", true)
          .order("created_at", { ascending: false })
          .limit(50);
        memoriesForDecision = Array.isArray(memRows)
          ? (memRows as any[]).map((m) => ({
              id: m.id,
              type: m.type,
              title: m.title,
              content: m.content,
            }))
          : [];
      } catch (memListErr) {
        console.error("[decision-router] Failed to load memories for router:", memListErr);
      }
    }

    // Unified decision router (model + topic + memory types)
    const activeTopicId = userMessageRow?.topic_id ?? null;
    const currentTopicMeta =
      Array.isArray(topicsForRouter) && activeTopicId
        ? topicsForRouter.find((t: any) => t.id === activeTopicId) || null
        : null;

    const allowLLMRouters = !forceSpeedMode;
    if (!allowLLMRouters) {
      console.log("[chatApi] Speed Mode enabled - skipping LLM routers (decision/writer).");
    }
    const decision = await runDecisionRouter({
      input: {
        userMessage: message,
        recentMessages: (recentMessagesForRouting || []).slice(-6).map((m: any) => ({
          role: m.role,
          content: m.content,
          topic_id: (m as any).topic_id ?? null,
        })),
        activeTopicId,
        currentConversationId: conversationId,
        speedMode,
        modelPreference: modelFamily,
        memories: memoriesForDecision,
        topics: Array.isArray(topicsForRouter) ? topicsForRouter : [],
        artifacts: Array.isArray(artifactsForRouter) ? artifactsForRouter : [],
      },
      allowLLM: allowLLMRouters,
    });
    if (await exitIfAborted()) {
      return;
    }
    console.log("[decision-router] output:", JSON.stringify(decision, null, 2));

    // Create a stub topic immediately for new-topic actions so downstream work (and the OpenAI call)
    // has a concrete topic_id. Writer router will refine metadata later.
    let resolvedPrimaryTopicId: string | null = decision.primaryTopicId ?? null;
    if (decision.topicAction === "new" && !resolvedPrimaryTopicId) {
      const stubLabel = buildAutoTopicLabel(message);
      const stubDescription = buildAutoTopicDescription(message);
      const stubSummary = buildAutoTopicSummary(message);
      try {
        const { data: stubTopic, error: stubErr } = await supabaseAny
          .from("conversation_topics")
          .insert([
            {
              conversation_id: conversationId,
              label: stubLabel.slice(0, 120),
              description: stubDescription?.slice(0, 500) ?? null,
              summary: stubSummary?.slice(0, 500) ?? null,
              parent_topic_id: decision.newParentTopicId ?? null,
            },
          ])
          .select()
          .single();
        if (stubErr || !stubTopic) {
          console.error("[topic-router] Failed to create stub topic:", stubErr);
        } else {
          resolvedPrimaryTopicId = stubTopic.id;
          console.log(`[topic-router] Created stub topic ${stubTopic.id} label="${stubTopic.label}"`);
        }
      } catch (stubCreateErr) {
        console.error("[topic-router] Exception creating stub topic:", stubCreateErr);
      }
    }

    // Tag user message with topic if available
    if (userMessageRow && resolvedPrimaryTopicId && userMessageRow.topic_id !== resolvedPrimaryTopicId) {
      try {
        await supabaseAny
          .from("messages")
          .update({ topic_id: resolvedPrimaryTopicId })
          .eq("id", userMessageRow.id);
        userMessageRow = { ...userMessageRow, topic_id: resolvedPrimaryTopicId };
      } catch (topicUpdateErr) {
        console.error("[topic-router] Failed to tag user message topic:", topicUpdateErr);
      }
    }

    // Refresh topic snapshot if we have a topic
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

    const resolvedTopicDecision: RouterDecision = {
      topicAction: decision.topicAction,
      primaryTopicId: resolvedPrimaryTopicId,
      secondaryTopicIds: decision.secondaryTopicIds ?? [],
      newTopicLabel: "",
      newTopicDescription: "",
      newTopicSummary: "",
      newParentTopicId: decision.newParentTopicId ?? null,
      artifactsToLoad: [],
    };

    const modelConfig = {
      model: decision.model,
      resolvedFamily: decision.model,
      reasoning: { effort: decision.effort },
      routedBy: "code" as const,
      availableMemoryTypes: decision.memoryTypesToLoad,
      memoriesToWrite: [] as any[],
      memoriesToDelete: [] as any[],
      permanentInstructionsToWrite: [] as any[],
      permanentInstructionsToDelete: [] as any[],
    };
    const reasoningEffort = decision.effort ?? "none";

    // Load personalization settings (used for both context building and memory selection)
    const personalizationSettings = await personalizationSettingsPromise;
    try {
      console.log("[personalization] loaded", {
        baseStyle: personalizationSettings?.baseStyle ?? null,
        referenceSavedMemories: Boolean(personalizationSettings?.referenceSavedMemories),
        referenceChatHistory: Boolean(personalizationSettings?.referenceChatHistory),
        allowSavingMemory: Boolean(personalizationSettings?.allowSavingMemory),
        customInstructionsChars: personalizationSettings?.customInstructions?.length ?? 0,
      });
    } catch {
      // ignore logging errors
    }

    let contextMessages;
    let contextSource: string;
    let includedTopicIds: string[] = [];
    let contextMessageIds: string[] = [];
    let summaryCount = 0;
    let artifactMessagesCount = 0;
	    if (effectiveSimpleContextMode && simpleContextPromise) {
	      const simpleContext = await simpleContextPromise;
	      contextMessages = simpleContext.messages;
	      contextSource = simpleContext.source;
	      includedTopicIds = simpleContext.includedTopicIds;
        contextMessageIds = simpleContext.includedMessageIds;
	      summaryCount = simpleContext.summaryCount;
      artifactMessagesCount = simpleContext.artifactCount;
      console.log(
	        `[context-builder] simple mode - context ${contextMessages.length} msgs (tokens: ${simpleContext.debug?.tokensUsed ?? "n/a"}/${simpleContext.debug?.budget ?? CONTEXT_LIMIT_TOKENS}, external chats: ${simpleContext.debug?.externalChatsIncluded ?? 0}/${simpleContext.debug?.externalChatsConsidered ?? 0})`
	      );
	    } else {
	      let manualTopicIds: string[] | null = null;
	      const requestedManualTopicIds = Array.isArray(effectiveAdvancedContextTopicIds)
	        ? effectiveAdvancedContextTopicIds.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
	        : [];

	      if (requestedManualTopicIds.length) {
	        try {
	          const { data: topicsById } = await supabaseAny
	            .from("conversation_topics")
	            .select("id, conversation_id")
	            .in("id", requestedManualTopicIds)
	            .limit(Math.min(requestedManualTopicIds.length, 200));

	          const topicRowsById = new Map<string, { id: string; conversation_id: string }>();
	          const convoIds = new Set<string>();
	          (Array.isArray(topicsById) ? topicsById : []).forEach((row: any) => {
	            if (!row?.id || !row?.conversation_id) return;
	            topicRowsById.set(String(row.id), { id: String(row.id), conversation_id: String(row.conversation_id) });
	            convoIds.add(String(row.conversation_id));
	          });

	          if (convoIds.size) {
	            const { data: convRows } = await supabaseAny
	              .from("conversations")
	              .select("id")
	              .eq("user_id", userId)
	              .in("id", Array.from(convoIds));

	            const allowedConversationIds = new Set<string>(
	              (Array.isArray(convRows) ? convRows : []).map((c: any) => String(c.id)).filter(Boolean)
	            );

	            const allowedTopicIds = requestedManualTopicIds.filter((id) => {
	              const topic = topicRowsById.get(id);
	              return topic ? allowedConversationIds.has(topic.conversation_id) : false;
	            });

	            manualTopicIds = allowedTopicIds.length ? allowedTopicIds : null;
	          }
	        } catch (err) {
	          console.warn("[context-builder] Failed to validate manual topics; falling back to auto:", err);
	          manualTopicIds = null;
	        }
	      }

	      const contextResult = await buildContextForMainModel({
	        supabase: supabaseAny,
	        conversationId,
	        routerDecision: resolvedTopicDecision,
	        manualTopicIds,
	      });
	      contextMessages = contextResult.messages;
	      contextSource = contextResult.source;
	      includedTopicIds = contextResult.includedTopicIds;
        contextMessageIds = contextResult.includedMessageIds;
	      summaryCount = contextResult.summaryCount;
      artifactMessagesCount = contextResult.artifactCount;
      console.log(
        `[context-builder] ${contextSource} mode - context ${contextMessages.length} msgs (summaries: ${summaryCount}, artifacts: ${artifactMessagesCount}, topics: ${
          includedTopicIds.length ? includedTopicIds.join(", ") : "none"
        })`
      );
    }

    if (marketContextMessages.length) {
      contextMessages = [...marketContextMessages, ...contextMessages];
    }

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
        // Use router-provided memory types (when available) instead of heuristics.
        const memoryTypes =
          Array.isArray(availableMemoryTypes) && availableMemoryTypes.length
            ? availableMemoryTypes
            : ["identity"];
        const memoryStrategy: MemoryStrategy = {
          types: memoryTypes,
          limit: 10,
        };

        console.log(`[memory] Using router-provided memory types:`, JSON.stringify(memoryStrategy));
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
        .map((a) => (a?.dataUrl || a?.url ? `Attachment: ${a.name ?? 'file'} (${a.mime || 'unknown type'})` : ""))
        .filter((line) => line.length > 0)
    : [] as string[];
  let expandedMessageWithAttachments = expandedMessage;
  if (attachmentLines.length) {
    expandedMessageWithAttachments += "\n\n" + attachmentLines.join("\n");
  }
  let totalFileUploadSize = 0;
  // Try to reuse an existing vector store from recent messages
  let vectorStoreId: string | undefined;
  let vectorStoreOpenAI: OpenAIClient | null = null;
  const inputFileParts: Array<{ type: "input_file"; file_id: string }> = [];
  const deferredAttachmentTasks: Promise<void>[] = []; // Run after stream starts to avoid delaying initial response
  try {
    const convoVectorId =
      typeof conversationMetadata?.vector_store_id === "string" &&
      conversationMetadata.vector_store_id.trim().length > 0
        ? conversationMetadata.vector_store_id.trim()
        : null;
    if (convoVectorId) {
      vectorStoreId = convoVectorId;
    }
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
      if (!att?.dataUrl && !att?.url) continue;

      try {
        const buffer = await attachmentToBuffer(att);
        if (!buffer) continue;
        const fileSize = buffer.length;
        const resolvedMime = resolveAttachmentMime(att);
        const isImage = typeof resolvedMime === "string" && resolvedMime.startsWith("image/");
        const shouldUpload = !isImage || fileSize > 100 * 1024;
        const withinFileApiLimit = fileSize <= 50 * 1024 * 1024; // 50 MB per OpenAI file input
        // Upload to OpenAI for file_search when not a small image
        if (shouldUpload) {
          const uploadTask = async () => {
            try {
              // Convert Buffer to Uint8Array for Blob compatibility
              const uint8Array = new Uint8Array(buffer);
              const contentType = resolvedMime || "application/octet-stream";
              const blob = new Blob([uint8Array], { type: contentType });
              const file = new File([blob], att.name || "file", { type: contentType });

              // Upload to OpenAI vector store directly (like legacy)
              if (!vectorStoreOpenAI) {
                const OpenAIConstructor = await getOpenAIConstructor();
                vectorStoreOpenAI = new OpenAIConstructor(
                  buildOpenAIClientOptions({
                    apiKey: process.env.OPENAI_API_KEY,
                  })
                );
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
              totalFileUploadSize += fileSize;
              console.log(`Uploaded to vector store: ${att.name} (${fileSize} bytes)`);
            } catch (uploadErr) {
              console.error(`Failed to upload ${att.name} to OpenAI:`, uploadErr);
            }
          };

          // For image uploads, defer to background to avoid delaying initial stream start
          if (isImage) {
            deferredAttachmentTasks.push(uploadTask());
          } else {
            await uploadTask();
          }
        }

        // Upload to OpenAI Files API for direct input_file consumption (skip images; require <=50MB)
        const isPdf =
          (typeof resolvedMime === "string" && resolvedMime.includes("pdf")) ||
          (typeof att.name === "string" && att.name.toLowerCase().endsWith(".pdf"));
        if (!isImage && withinFileApiLimit && isPdf) {
          try {
            if (!vectorStoreOpenAI) {
              const OpenAIConstructor = await getOpenAIConstructor();
              vectorStoreOpenAI = new OpenAIConstructor(
                buildOpenAIClientOptions({
                  apiKey: process.env.OPENAI_API_KEY,
                })
              );
            }
            const uploadable = await toFile(buffer, att.name || "file", {
              type: resolvedMime || "application/octet-stream",
            });
            const uploaded = await vectorStoreOpenAI.files.create({
              file: uploadable,
              purpose: "user_data",
            });
            inputFileParts.push({ type: "input_file", file_id: uploaded.id });
            console.log(`Uploaded input_file to OpenAI: ${att.name} (${uploaded.id})`);
          } catch (fileUploadErr) {
            console.error(`Failed to upload ${att.name} as input_file:`, fileUploadErr);
          }
        } else if (!isImage && !withinFileApiLimit && isPdf) {
          console.warn(`Skipping input_file upload for ${att.name} (>50MB)`);
        } else if (!isImage && !isPdf) {
          console.log(`Skipped input_file upload for ${att.name} (non-PDF; use vector store + file_search)`);
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
          if (vectorStoreId && conversationMetadata?.vector_store_id !== vectorStoreId) {
            try {
              const convMeta: Record<string, unknown> =
                conversationMetadata && typeof conversationMetadata === "object" && !Array.isArray(conversationMetadata)
                  ? { ...(conversationMetadata as Record<string, unknown>) }
                  : {};
              const nextConvMeta = { ...convMeta, vector_store_id: vectorStoreId };
              const { error: convErr } = await supabaseAny
                .from("conversations")
                .update({ metadata: nextConvMeta })
                .eq("id", conversationId)
                .eq("user_id", userId);
              if (convErr) {
                console.warn("Failed to persist vector store id on conversation:", convErr);
              } else {
                conversationMetadata = nextConvMeta;
              }
            } catch (convPersistErr) {
              console.warn("Unable to persist vector store id on conversation:", convPersistErr);
            }
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

        // Track cumulative bytes per user for daily logging
        try {
          const { data: existing } = await supabaseAny
            .from("vector_storage_usage")
            .select("total_bytes,last_logged_at")
            .eq("user_id", userId)
            .single();
          const prevBytes = existing?.total_bytes ?? 0;
          const updatedBytes = prevBytes + totalFileUploadSize;
          await supabaseAny
            .from("vector_storage_usage")
            .upsert({
              user_id: userId,
              total_bytes: updatedBytes,
              last_logged_at: existing?.last_logged_at ?? new Date().toISOString(),
            });
          console.log(`[vectorStorage] Updated tracked bytes: ${updatedBytes}`);
        } catch (trackErr) {
          console.warn("[vectorStorage] Failed to update tracked bytes:", trackErr);
        }
      } catch (storageErr) {
        console.error("[vectorStorage] Failed to log storage cost:", storageErr);
      }
    }
    
    // Skipping server-side extraction; rely on OpenAI vector store/file inputs for content access.
  }

  const vectorStoreIdsForRequest = await loadVectorStoreIdsForMessageIds(
    supabaseAny,
    contextMessageIds
  );
  console.log(`[chatApi] Final message length: ${expandedMessageWithAttachments.length} chars`);
  console.log(
    `[chatApi] Vector store IDs (context): ${
      vectorStoreIdsForRequest.length ? vectorStoreIdsForRequest.join(", ") : "none"
    }`
  );

  
  // Build instructions from system prompts with personalization and memories
    const chatLabel = conversation.title || "Untitled chat";
    const workspaceInstruction = conversation.project_id
      ? `You are working in project "${projectMeta?.name ?? "Unnamed project"}" (ID: ${conversation.project_id}). Current chat: "${chatLabel}" (${conversation.id}). If asked what project you're in, answer with the project name.`
      : `No active project. Current chat: "${chatLabel}" (${conversation.id}). If asked what project you're in, explain this chat is outside a project.`;

    // Base style + custom instructions should apply even when the user disables
    // saved-memory referencing (privacy). Only the memory blocks themselves are gated.
    const memoryReferenceEnabled = Boolean(personalizationSettings?.referenceSavedMemories);

    const baseSystemInstructionParts = [
      memoryReferenceEnabled
        ? BASE_SYSTEM_PROMPT
        : stripMemoryBehaviorBlock(BASE_SYSTEM_PROMPT),
      workspaceInstruction,
      `When it is helpful to show images (e.g., the user asks for pictures), you may include inline images using Markdown image syntax like ![alt](https://...direct-image-url). Limit to at most ${MAX_ASSISTANT_IMAGES_PER_MESSAGE} images per message.\n- Prefer DIRECT image URLs that return an image content-type (image/jpeg, image/png, image/webp, image/gif).\n- Avoid unstable random-image endpoints like source.unsplash.com (they often fail or change). If you use Unsplash, prefer direct images.unsplash.com URLs or a normal page URL with an OG image.\n- If you only have a page URL, include it as an image URL (the server will try to resolve an OG image).`,
      "You can inline-read files when the user includes tokens like <<file:relative/path/to/file>> in their prompt. Replace those tokens with the file content and use it in your reasoning.",
      ...(effectiveLocation ? [`User's location: ${effectiveLocation.city} (${effectiveLocation.lat.toFixed(4)}, ${effectiveLocation.lng.toFixed(4)}). Use this for location-specific queries like weather, local events, or "near me" searches.`] : []),
      ...(effectiveTimezone
        ? [
            (() => {
              let localTimeInfo = "";
              try {
                const ts = typeof clientNow === "number" ? clientNow : Date.now();
                localTimeInfo = new Date(ts).toLocaleString("en-US", {
                  timeZone: effectiveTimezone,
                  dateStyle: "full",
                  timeStyle: "long",
                });
              } catch {
                localTimeInfo = "";
              }
              return `User timezone: ${effectiveTimezone}. ${
                localTimeInfo ? `Current local date/time (user): ${localTimeInfo}. ` : ""
              }Always interpret relative dates ("today", "tomorrow", etc.) using this timezone and current local time. Do NOT assume UTC.`;
            })()
          ]
        : []),
    ];

    // Build user content with native image inputs when available to leverage model vision
    const userContentParts: any[] = [
      { type: "input_text", text: expandedMessageWithAttachments },
    ];
    const attachedImageUrls = new Set<string>();
    // Include current-turn image attachments directly for vision
    if (Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        const resolvedMime = resolveAttachmentMime(att);
        const isImage = typeof resolvedMime === "string" && resolvedMime.startsWith("image/");
        const imageUrl = att?.dataUrl || att?.url;
        if (isImage && imageUrl) {
          userContentParts.push({ type: "input_image", image_url: imageUrl });
          attachedImageUrls.add(imageUrl);
        }
      }
    }
    if (inputFileParts.length) {
      userContentParts.push(...inputFileParts);
    }
    // If no current attachments, reuse image attachments from messages included in context
    if (!Array.isArray(body.attachments) || body.attachments.length === 0) {
      try {
        const maxContextImages = 10;
        const contextImages = await loadImageAttachmentsForMessageIds(
          supabaseAny,
          contextMessageIds,
          maxContextImages
        );
        for (const img of contextImages) {
          if (attachedImageUrls.has(img.url)) continue;
          userContentParts.push({ type: "input_image", image_url: img.url });
          attachedImageUrls.add(img.url);
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
      openai = new OpenAIClass(
        buildOpenAIClientOptions({
          apiKey: process.env.OPENAI_API_KEY,
        })
      );
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
    const fileSearchTool = {
      type: "file_search" as const,
      ...(vectorStoreIdsForRequest.length ? { vector_store_ids: vectorStoreIdsForRequest } : {}),
    };
    
    // Memory management is now handled by the router model
    // No need for save_memory tool - router decides what to save based on user prompts
    let responseStream: any;
    let webSearchCallCount = 0;
    let fileSearchCallCount = 0;
    let discoveredCiContainerId: string | null = configuredCiContainerId;
    let codeInterpreterUsed = false;
    let ciStatusActive = false;

    const persistCodeInterpreterSessionIfNeeded = async (containerId: string) => {
      if (!containerId) return;

      const nextBilled = billedCiContainerIds.includes(containerId)
        ? billedCiContainerIds
        : [...billedCiContainerIds, containerId];

      const shouldLogCost = !billedCiContainerIds.includes(containerId);

      const nextConversationMetadata = {
        ...conversationMetadata,
        codeInterpreter: {
          ...(ciMeta || {}),
          containerId,
          billedContainerIds: nextBilled,
        },
      };

      // Persist container id/billing so future calls reuse the same session.
      try {
        await supabaseAny.from("conversations").update({ metadata: nextConversationMetadata }).eq("id", conversationId);
        conversationMetadata = nextConversationMetadata;
        (conversation as any).metadata = nextConversationMetadata;
      } catch (err) {
        console.warn("[code-interpreter] Failed to persist conversation metadata:", err);
      }

      if (shouldLogCost) {
        try {
          await logUsageRecord({
            userId,
            conversationId,
            model: "tool:code_interpreter",
            inputTokens: 0,
            cachedTokens: 0,
            outputTokens: 0,
            estimatedCost: CODE_INTERPRETER_SESSION_COST,
          });
          billedCiContainerIds.push(containerId);
          console.log(`[usage] Logged code_interpreter session container=${containerId} cost=$${CODE_INTERPRETER_SESSION_COST.toFixed(2)}`);
        } catch (err) {
          console.error("[usage] Failed to log code_interpreter session cost:", err);
        }
      }
    };

    // Use a stable container once we've discovered/persisted one; otherwise allow the API to create one lazily.
    const codeInterpreterTool: any = configuredCiContainerId
      ? { type: "code_interpreter", container: configuredCiContainerId }
      : { type: "code_interpreter", container: { type: "auto", memory_limit: "4g" } };

    const logVectorStorageDaily = async () => {
      if (!userId) return;
      try {
        const { data: vsRow, error: vsErr } = await supabaseAny
          .from("vector_storage_usage")
          .select("total_bytes,last_logged_at")
          .eq("user_id", userId)
          .single();
        if (vsErr || !vsRow || !vsRow.total_bytes) return;
        const totalBytes: number = vsRow.total_bytes;
        const lastLogged = vsRow.last_logged_at ? new Date(vsRow.last_logged_at) : null;
        const today = new Date();
        const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
        const lastUtc = lastLogged
          ? Date.UTC(
              lastLogged.getUTCFullYear(),
              lastLogged.getUTCMonth(),
              lastLogged.getUTCDate()
            )
          : null;
        const days = lastUtc === null ? 1 : Math.max(0, Math.floor((todayUtc - lastUtc) / 86_400_000));
        if (days <= 0) return;
        const cost = calculateVectorStorageCost(totalBytes, days);
        await supabaseAny
          .from("user_api_usage")
          .insert({
            id: crypto.randomUUID(),
            user_id: userId,
            conversation_id: conversationId,
            model: "vector-storage",
            input_tokens: 0,
            cached_tokens: 0,
            output_tokens: 0,
            estimated_cost: cost,
          });
        await supabaseAny
          .from("vector_storage_usage")
          .upsert({
            user_id: userId,
            total_bytes: totalBytes,
            last_logged_at: new Date(todayUtc).toISOString(),
          });
        console.log(
          `[vectorStorage] Logged ${days}d cost for ${totalBytes} bytes: $${cost.toFixed(6)}`
        );
      } catch (err) {
        console.warn("[vectorStorage] daily logging skipped:", err);
      }
    };
    const streamStartTimeoutMs = 20_000;
    let streamStartMs: number | null = null;
    let requestStartMs = 0;
    let assistantContent = "";
    let preambleBuffer = "";
    let firstTokenAtMs: number | null = null;
    const liveSearchDomainSet = new Set<string>();
    const liveSearchDomainList: string[] = [];
    let assistantMessageRow: MessageRow | null = null;
    let assistantInsertPromise: Promise<MessageRow | null> | null = null;

    const readableStream = new ReadableStream({
      async start(controller) {
        let controllerClosed = false;
        const closeControllerIfNeeded = () => {
          if (controllerClosed) return;
          controllerClosed = true;
          try {
            controller.close();
          } catch {
            // ignore
          }
        };
        const stopIfAborted = async () => {
          if (!abortSignal.aborted) return false;
          await exitIfAborted();
          closeControllerIfNeeded();
          return true;
        };
        const handleRequestAbort = () => {
          closeControllerIfNeeded();
          if (responseStream?.return) {
            responseStream.return().catch(() => {});
          }
          void exitIfAborted();
        };
        abortSignal.addEventListener("abort", handleRequestAbort);
          const encoder = new TextEncoder();
          const enqueueJson = (payload: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
          };
          if (await stopIfAborted()) {
            return;
          }
          if (deferredAttachmentTasks.length) {
            // Kick off deferred uploads/OCR without blocking the stream
            void Promise.allSettled(deferredAttachmentTasks).then((results) => {
              const failures = results.filter((r) => r.status === "rejected");
              if (failures.length) {
                console.warn(`[chatApi] ${failures.length} deferred attachment tasks failed`);
              }
            });
          }
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
        let pipelineGate = false;
        let customWebSearchContext: string | null = null;
        let customWebSearchDomains: string[] = [];
        let pipelineSkipped = false;
        let searchStarted = false;
        if (customWebSearchInput) {
          const numericSourceLimit =
            typeof customWebSearchInput.searchControls?.sourceLimit === "number"
              ? customWebSearchInput.searchControls.sourceLimit
              : undefined;
          try {
            customWebSearchResult = await runWebSearchPipeline(customWebSearchInput.prompt, {
              recentMessages: customWebSearchInput.recentMessages,
              currentDate: customWebSearchInput.currentDate,
              locationName: customWebSearchInput.location?.city ?? effectiveLocation?.city ?? undefined,
              languageCode: customWebSearchInput.location?.languageCode ?? undefined,
              countryCode: customWebSearchInput.location?.countryCode ?? undefined,
              preferredSourceUrls: customWebSearchInput.preferredSourceUrls,
              resultsPerQueryOverride: numericSourceLimit,
              maxEvidenceSources: numericSourceLimit,
              targetUsablePages: numericSourceLimit,
              excerptMode: customWebSearchInput.searchControls?.excerptMode,
              allowSkip: !forceWebSearch,
              onSearchStart: ({ query }) => {
                searchStarted = true;
                sendStatusUpdate({ type: "search-start", query });
              },
              onProgress: (event) => {
                if (!searchStarted) {
                  return;
                }
                sendStatusUpdate({ type: "search-progress", count: event.searched });
              },
            });
            console.log("[web-pipeline] completed for prompt");
          } catch (searchErr) {
            console.error("[web-pipeline] failed", searchErr);
            customWebSearchResult = null;
            if (searchStarted) {
              sendStatusUpdate({
                type: "search-error",
                query: customWebSearchInput.prompt,
                message: "Web search failed",
              });
            }
          }
          pipelineGate = customWebSearchResult?.gate?.enoughEvidence === true;
          pipelineSkipped = customWebSearchResult?.skipped === true;
          customWebSearchContext =
            customWebSearchResult && pipelineGate
              ? formatWebPipelineContext(customWebSearchResult)
              : null;
          customWebSearchDomains =
            customWebSearchResult && pipelineGate
              ? extractPipelineDomains(customWebSearchResult)
              : [];
          if (pipelineGate) {
            customWebSearchDomains.forEach((domain) => recordLiveSearchDomain(domain));
          }
          if (searchStarted) {
            const queryLabel =
              customWebSearchResult?.queries?.join(" | ")?.trim() || customWebSearchInput.prompt;
            sendStatusUpdate({
              type: "search-complete",
              query: queryLabel,
              results: customWebSearchResult?.results?.length ?? 0,
            });
          }
        }
        if (await stopIfAborted()) {
          return;
        }

        const allowWebSearch = !useCustomWebSearch || (!pipelineGate && !pipelineSkipped);
        const requireWebSearch = forceWebSearch && (!useCustomWebSearch || !pipelineGate);
        const webSearchInstructionParts = [
          ...(useCustomWebSearch && pipelineGate
            ? [
                "Use the provided web search context for any live/factual claims. Do NOT call the web_search tool.",
                "You must cite sources from the provided context using markdown links [text](url) and include a final 'Sources:' section listing all cited links.",
                "Every factual claim must include an inline citation immediately after the claim (same sentence).",
              ]
            : []),
          ...(customWebSearchContext ? [customWebSearchContext] : []),
          ...(allowWebSearch && forceWebSearch ? [FORCE_WEB_SEARCH_PROMPT] : []),
          ...(allowWebSearch && requireWebSearch && !forceWebSearch ? [EXPLICIT_WEB_SEARCH_PROMPT] : []),
        ];
        const systemInstructions = buildSystemPromptWithPersonalization(
          [...baseSystemInstructionParts, ...webSearchInstructionParts].join("\n\n"),
          personalizationSettings ?? {},
          memoryReferenceEnabled ? relevantMemories : [],
          permanentInstructions
        );

        const toolsForRequest: any[] = [];
        if (allowWebSearch) {
          toolsForRequest.push(webSearchTool);
        }
        if (vectorStoreIdsForRequest.length) {
          toolsForRequest.push(fileSearchTool as Tool);
        }
        toolsForRequest.push(codeInterpreterTool);
        const toolChoice: ToolChoiceOptions | undefined = allowWebSearch
          ? requireWebSearch
            ? "required"
            : "auto"
          : undefined;

        // Progressive flex processing: free users always, all users at 80%+ usage,
        // and GPT-5 Pro forces flex for non-Dev plans.
        const flexEligibleFamilies = ["gpt-5.2", "gpt-5.2-pro", "gpt-5-mini", "gpt-5-nano"];
        const isPromptModel = flexEligibleFamilies.includes(modelConfig.resolvedFamily);
        const forceProFlex = modelConfig.resolvedFamily === "gpt-5.2-pro" && userPlan !== "max";
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
          "gpt-5.2",
          "gpt-5.2-pro",
          "gpt-5.2-chat-latest",
          "gpt-5",
          "gpt-5-codex",
          "gpt-4.1",
        ]);
        const supportsExtendedCache = extendedCacheModels.has(modelConfig.model);

        const streamOptions: any = {
          model: modelConfig.model,
          instructions: systemInstructions,
          input: messagesForAPI,
          stream: true,
          store: true,
          prompt_cache_key: promptCacheKey,
          metadata: {
            user_id: userId,
            conversation_id: conversationId,
            ...(userMessageRow?.id ? { message_id: userMessageRow.id } : {}),
          },
        };
        const styleTuning = getStyleTuning(personalizationSettings?.baseStyle);
        if (styleTuning.textVerbosity) {
          streamOptions.text = { format: { type: "text" }, verbosity: styleTuning.textVerbosity };
        }
        const supportsTemperature = !/^gpt-5(\b|[-.])/i.test(modelConfig.model);
        if (supportsTemperature && typeof styleTuning.temperature === "number") {
          streamOptions.temperature = styleTuning.temperature;
        }
        if (supportsExtendedCache) {
          streamOptions.prompt_cache_retention = "24h";
        }
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
          streamOptions.reasoning = { effort: modelConfig.reasoning.effort };
        }
        if (typeof useFlex !== "undefined" && useFlex) {
          streamOptions.service_tier = "flex";
        }

        console.log("[chatApi] LLM payload", {
          model: streamOptions.model,
          instructions: streamOptions.instructions,
          input: streamOptions.input,
          metadata: streamOptions.metadata,
          tools: streamOptions.tools,
          prompt_cache_key: streamOptions.prompt_cache_key,
          reasoning: streamOptions.reasoning,
          service_tier: streamOptions.service_tier,
        });

        try {
          const streamStartPromise = (async () => {
            responseStream = await openai.responses.stream(streamOptions);
            streamStartMs = Date.now();
            return "started" as const;
          })();
          const streamStartResult = await Promise.race([
            streamStartPromise,
            new Promise<"timeout">((resolve) =>
              setTimeout(() => resolve("timeout"), streamStartTimeoutMs)
            ),
          ]);
          if (streamStartResult === "timeout" || !responseStream) {
            console.warn(
              `[chatApi] OpenAI stream did not start within ${streamStartTimeoutMs}ms; returning graceful fallback`
            );
            const fallbackMessage =
              "The model is taking unusually long to respond to this request (for example, when processing large or complex images). Please try again or simplify the request.";
            enqueueJson({
              model_info: {
                model: modelConfig.model,
                resolvedFamily: modelConfig.resolvedFamily,
                speedModeUsed: speedMode,
                reasoningEffort,
              },
            });
            enqueueJson({ token: fallbackMessage });
            enqueueJson({ done: true });
            controller.close();
            return;
          }
          console.log(
            "OpenAI stream started for model:",
            modelConfig.model,
            useFlex ? "(flex)" : "(standard)"
          );
          requestStartMs = Date.now();
          if (await stopIfAborted()) {
            return;
          }

          // Emit model info immediately so the UI can show effort badges before first token
          enqueueJson({
            model_info: {
              model: modelConfig.model,
              resolvedFamily: modelConfig.resolvedFamily,
              speedModeUsed: speedMode,
              reasoningEffort,
            },
          });
        } catch (streamErr) {
          console.error("Failed to start OpenAI stream:", streamErr);
          enqueueJson({ error: "stream_start_failed" });
          enqueueJson({ token: "Failed to start the model stream. Please retry." });
          enqueueJson({ done: true });
          controller.close();
          return;
        }
        let doneSent = false;
        let contextUsage:
          | {
              percent: number;
              limit: number;
              inputTokens: number;
              cachedTokens: number;
              outputTokens: number;
              model?: string;
            }
          | null = null;

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
            if (await stopIfAborted()) {
              break;
            }
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
            } else if (event.type === "response.reasoning.delta" && typeof (event as any).delta === "string") {
              const delta = (event as any).delta as string;
              preambleBuffer += delta;
              enqueueJson({ preamble_delta: delta });
            } else if (
              (event as any)?.item?.type === "reasoning" &&
              typeof extractReasoningText((event as any).item) === "string" &&
              (event.type === "response.output_item.added" || event.type === "response.output_item.done")
            ) {
              const text = extractReasoningText((event as any).item);
              if (text) {
                preambleBuffer += text;
                enqueueJson({ preamble_delta: text });
              }
            } else if (
              typeof (event as any)?.type === "string" &&
              String((event as any).type).toLowerCase().includes("code_interpreter")
            ) {
              codeInterpreterUsed = true;
              const maybeContainer = extractContainerIdFromCiEvent(event);
              if (maybeContainer) {
                discoveredCiContainerId = maybeContainer;
              }

              const t = String((event as any).type).toLowerCase();
              const isStart = t.includes("in_progress") || t.includes("running") || t.includes("started");
              const isDone = t.includes("completed") || t.includes("done");
              const isError = t.includes("failed") || t.includes("error");

              if (isStart && !ciStatusActive) {
                ciStatusActive = true;
                sendStatusUpdate({ type: "code-interpreter-start" });
              } else if (isDone && ciStatusActive) {
                ciStatusActive = false;
                sendStatusUpdate({ type: "code-interpreter-complete" });
              } else if (isError) {
                ciStatusActive = false;
                sendStatusUpdate({ type: "code-interpreter-error" });
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
              webSearchCallCount += 1;
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
              fileSearchCallCount += 1;
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
          if (await stopIfAborted()) {
            return;
          }

          const finalResponse = await responseStream.finalResponse();
          const endMs = Date.now();
          console.log("[chatApi] timing", {
            totalMs: endMs - requestStartMs,
            streamStartMs: streamStartMs ? streamStartMs - requestStartMs : null,
            firstTokenMs: firstTokenAtMs ? firstTokenAtMs - requestStartMs : null,
            streamDurationMs: streamStartMs ? endMs - streamStartMs : null,
          });
          if (finalResponse.output_text) {
            assistantContent = finalResponse.output_text;
          }

          // Rehost any inline images the assistant included in the message so they persist in chat history.
          let rehostedImages: AssistantInlineImage[] = [];
          try {
            const rehosted = await rehostAssistantInlineImages({
              userId,
              conversationId,
              content: assistantContent,
            });
            assistantContent = rehosted.content;
            rehostedImages = rehosted.images;
          } catch (imgErr) {
            console.warn("[assistant-images] Rehosting skipped:", imgErr);
          }
          if (!preambleBuffer) {
            const extracted = extractReasoningFromOutput((finalResponse as any)?.output);
            if (extracted) {
              preambleBuffer = extracted;
              enqueueJson({ preamble: extracted });
            }
          }

          const codeInterpreterFiles = extractCodeInterpreterFilesFromOutput((finalResponse as any)?.output);
          if (codeInterpreterFiles.length) {
            codeInterpreterUsed = true;
            if (!discoveredCiContainerId) {
              discoveredCiContainerId = codeInterpreterFiles[0]?.containerId ?? null;
            }
          }

          if (codeInterpreterUsed && discoveredCiContainerId) {
            await persistCodeInterpreterSessionIfNeeded(discoveredCiContainerId);
            if (ciStatusActive) {
              ciStatusActive = false;
              enqueueJson({ status: { type: "code-interpreter-complete" } });
            }
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

          // Compute context usage (input + cached tokens) against the 350k limit
          const totalContextTokens = inputTokens + cachedTokens;
          if (totalContextTokens > 0) {
            const percent = Math.min(
              100,
              Math.max(0, (totalContextTokens / CONTEXT_LIMIT_TOKENS) * 100)
            );
            contextUsage = {
              percent,
              limit: CONTEXT_LIMIT_TOKENS,
              inputTokens,
              cachedTokens,
              outputTokens,
              model: modelConfig.model,
            };
          }

          // Log usage to database
          if (inputTokens > 0 || outputTokens > 0) {
            try {
              await logUsageRecord({
                userId,
                conversationId,
                model: modelConfig.model,
                inputTokens,
                cachedTokens,
                outputTokens,
                estimatedCost: estimatedCost,
              });
              console.log(
                `[usage] Successfully logged: ${inputTokens} input, ${cachedTokens} cached, ${outputTokens} output, cost: $${estimatedCost.toFixed(6)}`
              );
            } catch (usageErr) {
              console.error("[usage] Failed to log usage:", usageErr);
            }
          } else {
          console.warn("[usage] No tokens to log (both input and output are 0)");
        }

        // Tool call costs
        if (userId && customWebSearchResult?.cost?.serpRequests) {
          const serpCost = customWebSearchResult.cost.serpEstimatedUsd ?? 0;
          if (serpCost > 0) {
            try {
              await logUsageRecord({
                userId,
                conversationId,
                model: "brightdata:serp",
                inputTokens: 0,
                cachedTokens: 0,
                outputTokens: 0,
                estimatedCost: serpCost,
              });
              console.log(
                `[usage] Logged brightdata serp requests=${customWebSearchResult.cost.serpRequests} cost=$${serpCost.toFixed(6)}`
              );
            } catch (err) {
              console.error("[usage] Failed to log brightdata serp calls:", err);
            }
          }
        }
        if (userId && customWebSearchResult?.cost?.brightdataUnlockerRequests) {
          const unlockerCost = customWebSearchResult.cost.brightdataUnlockerEstimatedUsd ?? 0;
          if (unlockerCost > 0) {
            try {
              await logUsageRecord({
                userId,
                conversationId,
                model: "brightdata:unlocker",
                inputTokens: 0,
                cachedTokens: 0,
                outputTokens: 0,
                estimatedCost: unlockerCost,
              });
              console.log(
                `[usage] Logged brightdata unlocker requests=${customWebSearchResult.cost.brightdataUnlockerRequests} cost=$${unlockerCost.toFixed(6)}`
              );
            } catch (err) {
              console.error("[usage] Failed to log brightdata unlocker calls:", err);
            }
          }
        }

        if (userId) {
          const webSearchCost = calculateToolCallCost("web_search", webSearchCallCount);
          if (webSearchCallCount > 0 && webSearchCost > 0) {
            try {
              await logUsageRecord({
                  userId,
                  conversationId,
                  model: "tool:web_search",
                  inputTokens: 0,
                  cachedTokens: 0,
                  outputTokens: 0,
                  estimatedCost: webSearchCost,
                });
                console.log(
                  `[usage] Logged web_search calls=${webSearchCallCount} cost=$${webSearchCost.toFixed(6)}`
                );
              } catch (err) {
                console.error("[usage] Failed to log web_search tool calls:", err);
              }
            }

            const fileSearchCost = calculateToolCallCost("file_search", fileSearchCallCount);
            if (fileSearchCallCount > 0 && fileSearchCost > 0) {
              try {
                await logUsageRecord({
                  userId,
                  conversationId,
                  model: "tool:file_search",
                  inputTokens: 0,
                  cachedTokens: 0,
                  outputTokens: 0,
                  estimatedCost: fileSearchCost,
                });
                console.log(
                  `[usage] Logged file_search calls=${fileSearchCallCount} cost=$${fileSearchCost.toFixed(6)}`
                );
              } catch (err) {
                console.error("[usage] Failed to log file_search tool calls:", err);
              }
            }

            // Log daily vector storage cost if applicable
            await logVectorStorageDaily();
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
          if (customWebSearchResult) {
            metadataPayload.webSearchQueries = customWebSearchResult.queries ?? [];
            metadataPayload.webSearchSources = customWebSearchResult.sources ?? [];
            metadataPayload.webSearchTimeSensitive = customWebSearchResult.timeSensitive ?? undefined;
            metadataPayload.webSearchUsedCache = Boolean(
              customWebSearchResult.reusedPersistentQuery ||
                (customWebSearchResult.serpCacheHits ?? 0) > 0
            );
          }
          if (rehostedImages.length) {
            (metadataPayload as any).inlineImages = rehostedImages;
          }
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
          if (preambleBuffer) {
            (metadataPayload as any).preamble = preambleBuffer;
          }
          if (codeInterpreterFiles.length) {
            (metadataPayload as any).generatedFiles = codeInterpreterFiles;
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
	            const contentToPersist =
	              codeInterpreterFiles.length > 0
	                ? rewriteCodeInterpreterDownloadLinks({
	                    content: assistantContent,
	                    messageId: persistedAssistantRow.id,
	                    files: codeInterpreterFiles,
	                  })
	                : assistantContent;
	            const { data: updatedRow, error: updateErr } = await supabaseAny
	              .from("messages")
	              .update({
	                content: contentToPersist,
	                openai_response_id: finalResponse.id || null,
	                metadata: metadataPayload,
	                preamble: preambleBuffer || null,
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
	                preamble: preambleBuffer || null,
	                topic_id: resolvedTopicDecision.primaryTopicId ?? null,
	              })
	              .select()
	              .single();

            if (assistantError || !insertedRow) {
              console.error("Failed to save assistant message:", assistantError);
	            } else {
	              assistantMessageRow = insertedRow as MessageRow;
	              persistedAssistantRow = assistantMessageRow;

	              if (codeInterpreterFiles.length > 0) {
	                const rewrittenContent = rewriteCodeInterpreterDownloadLinks({
	                  content: assistantContent,
	                  messageId: persistedAssistantRow.id,
	                  files: codeInterpreterFiles,
	                });
	                if (rewrittenContent !== assistantContent) {
	                  await supabaseAny
	                    .from("messages")
	                    .update({ content: rewrittenContent })
	                    .eq("id", persistedAssistantRow.id);
	                  persistedAssistantRow = { ...persistedAssistantRow, content: rewrittenContent } as any;
	                }
	              }
	            }
	          }

          // Run writer router now that we have the assistant reply (topic metadata, memories, artifacts).
          let writer: Awaited<ReturnType<typeof runWriterRouter>> | null = null;
          try {
            const writerRecentMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = (
              recentMessagesForRouting || []
            )
              .slice(-6)
              .map((m: any) => ({
                role: (m.role as "user" | "assistant" | "system") ?? "user",
                content: m.content ?? "",
              }));
            const writerMemoryMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
              ...writerRecentMessages.filter((m) => m.role === "user"),
              { role: "user", content: message },
            ];
            const writerTopicId = resolvedTopicDecision.primaryTopicId ?? activeTopicId ?? null;
            const writerTopics =
              Array.isArray(topicsForRouter) && topicsForRouter.length
                ? topicsForRouter
                    .slice(0, 8)
                    .map((t: any) => ({
                      id: t.id,
                      label: t.label,
                      summary: t.summary ?? null,
                      description: t.description ?? null,
                    }))
                : [];
            writer = await runWriterRouter(
              {
                userMessageText: message,
                assistantMessageText: assistantContent,
                recentMessages: writerRecentMessages,
                memoryRelevantMessages: writerMemoryMessages.slice(-6),
                topics: writerTopics,
                currentTopic: {
                  id: writerTopicId ?? null,
                  summary: currentTopicMeta?.summary ?? null,
                  description: currentTopicMeta?.description ?? null,
                },
              },
              decision.topicAction,
              { allowLLM: allowLLMRouters }
            );
            console.log("[writer-router] output (post-stream):", JSON.stringify(writer, null, 2));
          } catch (writerErr) {
            console.error("[writer-router] failed post-stream:", writerErr);
          }

          // Apply topic metadata writes (create/update) from writer router.
          const normalizeTopicText = (value?: string | null) => {
            if (!value) return null;
            const trimmed = value.trim();
            if (!trimmed) return null;
            const lower = trimmed.toLowerCase();
            if (["none", "null", "n/a", "na", "skip"].includes(lower)) return null;
            return trimmed;
          };
          const topicIdSet = new Set(
            (Array.isArray(topicsForRouter) ? topicsForRouter : []).map((t: any) => t.id)
          );
          if (resolvedPrimaryTopicId) topicIdSet.add(resolvedPrimaryTopicId);
          const writerTopicWrites: Array<{
            action: "create" | "update" | "skip";
            targetTopicId: string | null;
            label: string | null;
            summary: string | null;
            description: string | null;
          }> = [];
          if (writer?.topicWrite) writerTopicWrites.push(writer.topicWrite as any);
          if (Array.isArray(writer?.additionalTopicWrites)) {
            writerTopicWrites.push(
              ...writer.additionalTopicWrites.map((tw: any) => ({ ...tw, action: "update" as const }))
            );
          }

          for (const topicWrite of writerTopicWrites) {
            if (!topicWrite || topicWrite.action === "skip") continue;
            if (topicWrite.action === "create") {
              const label =
                normalizeTopicText(topicWrite.label) ||
                buildAutoTopicLabel(message);
              const description =
                normalizeTopicText(topicWrite.description) ||
                buildAutoTopicDescription(message);
              const summary =
                normalizeTopicText(topicWrite.summary) ||
                buildAutoTopicSummary(message);

              if (resolvedPrimaryTopicId) {
                const { error: updateErr } = await supabaseAny
                  .from("conversation_topics")
                  .update({
                    label: label.slice(0, 120),
                    description: description?.slice(0, 500) ?? null,
                    summary: summary?.slice(0, 500) ?? null,
                  })
                  .eq("id", resolvedPrimaryTopicId);
                if (updateErr) {
                  console.error("[topic-router] Failed to update stub topic metadata:", updateErr);
                } else {
                  console.log(`[topic-router] Updated stub topic ${resolvedPrimaryTopicId} metadata from writer router`);
                }
              } else {
                const { data: insertedTopic, error: topicErr } = await supabaseAny
                  .from("conversation_topics")
                  .insert([
                    {
                      conversation_id: conversationId,
                      label: label.slice(0, 120),
                      description: description?.slice(0, 500) ?? null,
                      summary: summary?.slice(0, 500) ?? null,
                      parent_topic_id: decision.newParentTopicId ?? null,
                    },
                  ])
                  .select()
                  .single();
                if (topicErr || !insertedTopic) {
                  console.error("[topic-router] Failed to create topic:", topicErr);
                } else {
                  resolvedPrimaryTopicId = insertedTopic.id;
                  topicIdSet.add(insertedTopic.id);
                  console.log(`[topic-router] Created topic ${insertedTopic.id} label="${insertedTopic.label}"`);
                }
              }
            } else if (topicWrite.action === "update") {
              const targetId =
                topicWrite.targetTopicId ??
                resolvedPrimaryTopicId ??
                activeTopicId;
              if (!targetId || !topicIdSet.has(targetId)) {
                continue;
              }
              const updatePayload: Record<string, any> = {};
              const label = normalizeTopicText(topicWrite.label);
              const summary = normalizeTopicText(topicWrite.summary);
              const description = normalizeTopicText(topicWrite.description);
              if (label) updatePayload.label = label.slice(0, 120);
              if (summary) updatePayload.summary = summary.slice(0, 500) ?? null;
              if (description) updatePayload.description = description.slice(0, 500) ?? null;
              if (!Object.keys(updatePayload).length) continue;
              const { error: updateErr } = await supabaseAny
                .from("conversation_topics")
                .update(updatePayload)
                .eq("id", targetId);
              if (updateErr) {
                console.error(`[topic-router] Failed to update topic ${targetId} metadata:`, updateErr);
              } else {
                console.log(`[topic-router] Updated topic ${targetId} metadata from writer router`);
              }
            }
          }

          // Capture writer outputs for downstream persistence.
          if (writer) {
            (modelConfig as any).memoriesToWrite = writer.memoriesToWrite || [];
            (modelConfig as any).memoriesToDelete = writer.memoriesToDelete || [];
            (modelConfig as any).permanentInstructionsToWrite = writer.permanentInstructionsToWrite || [];
            (modelConfig as any).permanentInstructionsToDelete = writer.permanentInstructionsToDelete || [];
            (modelConfig as any).artifactsToWrite = writer.artifactsToWrite || [];
          }
          if (await exitIfAborted()) {
            return;
          }

          // Apply permanent instruction writes/deletes after streaming (router + heuristics).
          {
            const permanentInstructionWrites = (modelConfig as any).permanentInstructionsToWrite || [];
            let permanentInstructionDeletes = (modelConfig as any).permanentInstructionsToDelete || [];

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

            const wantsFullClear = false;
            if (wantsFullClear) {
              for (const inst of loadedInstructions) {
                addDeleteIfMissing(inst.id, "User requested to clear permanent instructions");
              }
            } else {
              const userWantsNicknameRemoved = /stop\s+call(?:ing)?\s+me|don['ƒ?T]t\s+call\s+me|do\s+not\s+call\s+me|forget\s+.*call\s+me/i.test(
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

            if (permanentInstructionsChanged) {
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
          }

          let assistantRowForMeta = persistedAssistantRow;

          if (!assistantRowForMeta) {
            enqueueJson({
              meta: {
                assistantMessageRowId: `error-${Date.now()}`,
                userMessageRowId: userMessageRow?.id,
                model: modelConfig.model,
                reasoningEffort,
                resolvedFamily: modelConfig.resolvedFamily,
                speedModeUsed: speedMode,
                finalContent: assistantContent,
                metadata: metadataPayload,
                ...(contextUsage ? { contextUsage } : {}),
              },
            });
          } else {
            try {
              const memoriesToWrite = Array.isArray((modelConfig as any).memoriesToWrite)
                ? (modelConfig as any).memoriesToWrite.filter(
                    (memory: any) =>
                      memory &&
                      typeof memory.type === "string" &&
                      memory.type.trim().length > 0 &&
                      typeof memory.title === "string" &&
                      memory.title.trim().length > 0 &&
                      typeof memory.content === "string" &&
                      memory.content.trim().length > 0
                  )
                : [];
              const canWriteMemories =
                personalizationSettings.allowSavingMemory && MEMORY_WRITES_ENABLED && memoriesToWrite.length > 0;
              if (canWriteMemories) {
                console.log(`[router-memory] Writing ${memoriesToWrite.length} memories from router decision`);
                let vectorWritesBlocked = false;
                for (const memory of memoriesToWrite) {
                  if (vectorWritesBlocked) break;
                  try {
                    await writeMemory({
                      type: memory.type,
                      title: memory.title,
                      content: memory.content,
                      enabled: true,
                      conversationId,
                    });
                    console.log(`[router-memory] Wrote memory: ${memory.title} (type: ${memory.type})`);
                  } catch (err: any) {
                    const msg = String(err?.message || err || "");
                    if (msg.toLowerCase().includes("vector") || String(err?.code || "").includes("42704")) {
                      vectorWritesBlocked = true;
                      console.warn("[router-memory] Skipping memory writes; vector extension/column missing");
                      break;
                    } else {
                      console.error("[router-memory] Failed to write memory:", err);
                    }
                  }
                }
              }

              const memoriesToDelete = Array.isArray((modelConfig as any).memoriesToDelete)
                ? (modelConfig as any).memoriesToDelete.filter(
                    (m: any) =>
                      m &&
                      typeof m.id === "string" &&
                      m.id.trim().length > 0 &&
                      typeof m.reason === "string" &&
                      m.reason.trim().length > 0
                  )
                : [];
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

            // Write artifacts chosen by writer router (using assistant reply as source).
            try {
              if (!assistantRowForMeta) {
                console.warn("[artifacts] Skipping artifact write; missing assistant message row.");
              } else {
                const assistantRow = assistantRowForMeta;
                const artifactsFromRouter = Array.isArray((modelConfig as any).artifactsToWrite)
                  ? (modelConfig as any).artifactsToWrite.filter(
                      (a: any) =>
                        a &&
                        typeof a.type === "string" &&
                        a.type.trim().length > 0 &&
                        typeof a.title === "string" &&
                        a.title.trim().length > 0 &&
                        typeof a.content === "string" &&
                        a.content.trim().length >= 1
                    )
                  : [];
                const topicIdForArtifacts =
                  assistantRow.topic_id ??
                  resolvedTopicDecision.primaryTopicId ??
                  userMessageRow?.topic_id ??
                  null;
                const canWriteArtifacts = Boolean(topicIdForArtifacts) && artifactsFromRouter.length > 0;
                if (canWriteArtifacts) {
                  if (assistantRow.topic_id !== topicIdForArtifacts) {
                    try {
                      await supabaseAny
                        .from("messages")
                        .update({ topic_id: topicIdForArtifacts })
                        .eq("id", assistantRow.id);
                      assistantRowForMeta = { ...assistantRowForMeta, topic_id: topicIdForArtifacts } as any;
                    } catch (topicUpdateErr) {
                      console.error("[artifacts] Failed to backfill assistant topic_id:", topicUpdateErr);
                    }
                  }
                  const inserts = artifactsFromRouter.map((art: any) => {
                    const content = String(art.content || "").trim();
                    const title = String(art.title || "").trim().slice(0, 200) || "Artifact";
                    const type = typeof art.type === "string" ? art.type : "other";
                    const summary = content.replace(/\s+/g, " ").slice(0, 180);
                    const tokenEstimate = Math.max(50, Math.round(Math.max(summary.length, content.length) / 4));
                    const keywords = extractKeywords([title, summary, content].join(" "), undefined);
                    return {
                      conversation_id: assistantRow.conversation_id,
                      topic_id: topicIdForArtifacts,
                      created_by_message_id: assistantRow.id,
                      type,
                      title,
                      summary,
                      content,
                      token_estimate: tokenEstimate,
                      keywords,
                    };
                  });

                  try {
                    let artifactClient: any = supabaseAny;
                    try {
                      artifactClient = await supabaseServerAdmin();
                    } catch (adminErr) {
                      console.warn("[artifacts] Admin client unavailable; falling back to user client:", adminErr);
                    }
                    await artifactClient.from("artifacts").insert(inserts);
                    console.log(`[artifacts] Inserted ${inserts.length} artifacts from writer router`);
                  } catch (error: any) {
                    console.error("[artifacts] Failed to insert artifacts:", error);
                    if (String(error?.message || "").includes("keywords")) {
                      const insertsNoKeywords = inserts.map((insert: any) => {
                        const rest = { ...insert };
                        delete (rest as any).keywords;
                        return rest;
                      });
                      try {
                        let artifactClient: any = supabaseAny;
                        try {
                          artifactClient = await supabaseServerAdmin();
                        } catch (adminErr) {
                          console.warn("[artifacts] Admin client unavailable; falling back to user client:", adminErr);
                        }
                        await artifactClient.from("artifacts").insert(insertsNoKeywords);
                        console.log(`[artifacts] Inserted ${insertsNoKeywords.length} artifacts without keywords (keywords column missing)`);
                      } catch (err2) {
                        console.error("[artifacts] Retry insert without keywords failed:", err2);
                      }
                    }
                  }
                }
              }
            } catch (artifactErr) {
              console.error("[artifacts] Failed to write artifacts from router:", artifactErr);
            }

            enqueueJson({
              meta: {
                assistantMessageRowId: assistantRowForMeta?.id ?? null,
                userMessageRowId: userMessageRow?.id,
                model: modelConfig.model,
                reasoningEffort,
                resolvedFamily: modelConfig.resolvedFamily,
                speedModeUsed: speedMode,
                finalContent: assistantRowForMeta?.content ?? assistantContent,
                metadata:
                  (assistantRowForMeta?.metadata as AssistantMessageMetadata | null) ??
                  metadataPayload,
                ...(contextUsage ? { contextUsage } : {}),
              },
            });

            if (assistantRowForMeta?.topic_id) {
              try {
                await updateTopicSnapshot({
                  supabase: supabaseAny,
                  topicId: assistantRowForMeta.topic_id,
                  latestMessage: assistantRowForMeta,
                });
              } catch (snapshotErr) {
                console.error("[topic-router] Failed to refresh topic snapshot for assistant:", snapshotErr);
              }
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
          closeControllerIfNeeded();
          abortSignal.removeEventListener("abort", handleRequestAbort);
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

