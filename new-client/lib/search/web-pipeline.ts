import { performance } from "perf_hooks";
import { convert } from "html-to-text";
import { createHash } from "crypto";
import { createOpenAIClient } from "@/lib/openai/client";
import { extractDomainFromUrl } from "@/lib/metadata";
import { supabaseServer } from "@/lib/supabase/server";
import { fetchGoogleOrganicSerp } from "@/lib/search/brightdata-serp";
import {
  assessTimeSensitivity,
  runEvidenceGate,
  writeSearchQueries,
} from "@/lib/search/search-llm";
import { calculateEmbeddingCost } from "@/lib/pricing";
import { estimateTokens } from "@/lib/tokens/estimateTokens";

type PipelineOptions = {
  queryCount?: number;
  serpDepth?: number;
  fetchCandidateLimit?: number;
  pageLimit?: number;
  pageTimeoutMs?: number;
  pageMaxBytes?: number;
  minPageTextLength?: number;
  minContentRatio?: number;
  chunkSize?: number;
  chunkOverlap?: number;
  topK?: number;
  maxChunksPerDomain?: number;
  maxChunksPerUrl?: number;
  maxTotalPages?: number;
  linkDepth?: number;
  includeLinkedPages?: boolean;
  locationName?: string;
  languageCode?: string;
  countryCode?: string;
  device?: "desktop" | "mobile";
  recentMessages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  currentDate?: string;
  onSearchStart?: (event: { query: string; queries: string[] }) => void;
  onProgress?: (event: { type: "page_fetch_progress"; searched: number }) => void;
  retryOnGateFailure?: boolean;
  allowSkip?: boolean;
  preferredSourceUrls?: string[];
  preferredSourceChunkLimit?: number;
  preferredSourceTokenBudget?: number;
};

export type WebPipelineChunk = {
  text: string;
  url: string;
  title: string | null;
  domain: string | null;
  score: number;
};

export type WebPipelineResult = {
  queries: string[];
  results: Array<{
    url: string;
    title: string;
    description?: string | null;
    position?: number | null;
    domain?: string | null;
  }>;
  chunks: WebPipelineChunk[];
  sources: Array<{ title: string; url: string }>;
  gate: { enoughEvidence: boolean };
  expanded: boolean;
  skipped?: boolean;
  skipReason?: string;
  timeSensitive?: boolean;
  reusedPersistentQuery?: boolean;
  serpCacheHits?: number;
  pageCacheHits?: number;
  cost?: {
    serpRequests: number;
    serpEstimatedUsd: number;
    brightdataUnlockerRequests: number;
    brightdataUnlockerEstimatedUsd: number;
  };
};

const EMBEDDING_MODEL = "text-embedding-3-small";
const SERP_CACHE_PREFIX = "brightdata:serp:google:";
const PAGE_CACHE_PREFIX = "page:";
const SERP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const BRIGHTDATA_SERP_COST_USD = 0.0015;
const BRIGHTDATA_UNLOCKER_COST_USD = 0.0015;
const MAX_EMBED_CHUNKS = 80;
const VERBOSE_WEB_LOG = process.env.WEB_PIPELINE_VERBOSE === "1";
const LOG_LIST_CAP = VERBOSE_WEB_LOG ? Number.MAX_SAFE_INTEGER : 20;
const DEFAULTS = {
  queryCount: 2,
  serpDepth: 10,
  fetchCandidateLimit: 20,
  pageLimit: 10,
  pageTimeoutMs: 12_000,
  pageMaxBytes: 8 * 1024 * 1024,
  minPageTextLength: 2000,
  minContentRatio: 0.02,
  chunkSize: 1000,
  chunkOverlap: 200,
  topK: 50,
  maxChunksPerDomain: 3,
  maxChunksPerUrl: 2,
  maxTotalPages: 150,
  linkDepth: 20,
  includeLinkedPages: true,
  locationName: "United States",
  languageCode: "en",
  countryCode: "us",
  device: "desktop" as const,
  preferredSourceChunkLimit: 4,
  preferredSourceTokenBudget: 6000,
};

const PERSISTENT_QUERY_SIMILARITY_THRESHOLD = 0.88;
const PERSISTENT_QUERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PERSISTENT_DOCUMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

let cachedOpenAIClient: ReturnType<typeof createOpenAIClient> | null = null;

function toTimestamp(value: unknown): number {
  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

function logCapped(label: string, items: unknown[]) {
  if (!Array.isArray(items)) return console.log(label, items);
  if (items.length <= LOG_LIST_CAP) {
    console.log(label, items);
  } else {
    console.log(label, items.slice(0, LOG_LIST_CAP), { truncated: items.length - LOG_LIST_CAP });
  }
}

function getOpenAIClient() {
  if (cachedOpenAIClient) return cachedOpenAIClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[web-pipeline] OPENAI_API_KEY not set; embeddings disabled.");
    return null;
  }
  cachedOpenAIClient = createOpenAIClient({ apiKey });
  return cachedOpenAIClient;
}

async function loadSerpCache(cacheKey: string) {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("web_search_serp_cache")
      .select("payload, created_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    const createdAt = toTimestamp((data as { created_at?: unknown }).created_at);
    if (!createdAt || Date.now() - createdAt > SERP_CACHE_TTL_MS) return null;
    return data.payload as any;
  } catch (error) {
    console.warn("[web-pipeline] failed to load SERP cache", error);
    return null;
  }
}

async function saveSerpCache(cacheKey: string, query: string, payload: unknown) {
  try {
    const supabase = await supabaseServer();
    await supabase.from("web_search_serp_cache").upsert({
      cache_key: cacheKey,
      query,
      provider: "brightdata",
      payload,
    });
  } catch (error) {
    console.warn("[web-pipeline] failed to save SERP cache", error);
  }
}

async function loadPageCache(cacheKey: string) {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("web_search_page_cache")
      .select("html, text_content, status, truncated, created_at")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    if (error || !data) return null;
    const createdAt = toTimestamp((data as { created_at?: unknown }).created_at);
    if (!createdAt || Date.now() - createdAt > PAGE_CACHE_TTL_MS) return null;
    return data;
  } catch (error) {
    console.warn("[web-pipeline] failed to load page cache", error);
    return null;
  }
}

async function savePageCache(cacheKey: string, url: string, payload: any) {
  try {
    const supabase = await supabaseServer();
    await supabase.from("web_search_page_cache").upsert({
      cache_key: cacheKey,
      url,
      status: payload.status ?? null,
      truncated: payload.truncated ?? false,
      html: payload.html ?? null,
      text_content: payload.text ?? null,
    });
  } catch (error) {
    console.warn("[web-pipeline] failed to save page cache", error);
  }
}

function normalizeUrlKey(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "");
  } catch {
    return value.trim().toLowerCase();
  }
}

const NON_HTML_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "mp3",
  "wav",
  "m4a",
  "flac",
  "ogg",
  "mp4",
  "mov",
  "avi",
  "wmv",
  "mkv",
  "webm",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "dmg",
  "iso",
  "exe",
  "msi",
  "apk",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "csv",
  "tsv",
  "json",
  "xml",
  "rss",
  "atom",
]);

const PATH_KEYWORD_SKIP = [
  "privacy",
  "terms",
  "tos",
  "cookie",
  "cookies",
  "policy",
  "legal",
  "gdpr",
  "ccpa",
  "careers",
  "jobs",
  "about",
  "contact",
  "press",
  "advert",
  "sitemap",
  "login",
  "signup",
  "register",
  "account",
  "subscribe",
];

function isHtmlContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return normalized.includes("text/html") || normalized.includes("application/xhtml+xml");
}

function isLikelyHtmlUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const pathLower = parsed.pathname.toLowerCase();
    for (const keyword of PATH_KEYWORD_SKIP) {
      if (pathLower.includes(keyword)) return false;
    }
    const pathname = parsed.pathname.toLowerCase();
    if (!pathname || pathname.endsWith("/")) return true;
    const lastSegment = pathname.split("/").pop() ?? "";
    if (!lastSegment || !lastSegment.includes(".")) return true;
    const ext = lastSegment.split(".").pop() ?? "";
    if (!ext) return true;
    return !NON_HTML_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  if (!html) return [];
  const links = new Set<string>();
  const hrefRegex = /<a\s[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^'"\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!raw) continue;
    const cleaned = raw.replace(/&amp;/g, "&");
    const lower = cleaned.toLowerCase();
    if (
      lower.startsWith("#") ||
      lower.startsWith("mailto:") ||
      lower.startsWith("javascript:") ||
      lower.startsWith("tel:") ||
      lower.startsWith("sms:") ||
      lower.startsWith("data:")
    ) {
      continue;
    }
    try {
      const resolved = new URL(cleaned, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      resolved.hash = "";
      links.add(resolved.toString());
    } catch {
      continue;
    }
  }
  return Array.from(links);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitByTokens(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const word of words) {
    const wordTokens = Math.max(estimateTokens(word), 1);
    if (currentTokens + wordTokens > maxTokens && current.length > 0) {
      chunks.push(current.join(" "));
      current = [word];
      currentTokens = wordTokens;
      continue;
    }
    current.push(word);
    currentTokens += wordTokens;
  }
  if (current.length) {
    chunks.push(current.join(" "));
  }
  return chunks;
}

function takeTailByTokens(text: string, targetTokens: number): string {
  if (targetTokens <= 0) return "";
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const tokenCounts = words.map((word) => Math.max(estimateTokens(word), 1));
  let total = 0;
  let start = words.length;
  for (let i = words.length - 1; i >= 0; i -= 1) {
    total += tokenCounts[i];
    if (total >= targetTokens) {
      start = i;
      break;
    }
  }
  return words.slice(start).join(" ");
}

function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  let currentTokens = 0;

  const pushChunk = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) {
      chunks.push(trimmed);
    }
  };

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);
    if (paraTokens > chunkSize) {
      const splitParas = splitByTokens(para, chunkSize);
      for (const splitPara of splitParas) {
        const splitTokens = estimateTokens(splitPara);
        if (currentTokens + splitTokens <= chunkSize) {
          current = current ? `${current}\n\n${splitPara}` : splitPara;
          currentTokens += splitTokens;
        } else {
          pushChunk();
          const overlapText = overlap > 0 ? takeTailByTokens(current, overlap) : "";
          current = overlapText ? `${overlapText}\n\n${splitPara}` : splitPara;
          currentTokens = (overlapText ? estimateTokens(overlapText) : 0) + splitTokens;
        }
      }
      continue;
    }

    if (currentTokens + paraTokens <= chunkSize) {
      current = current ? `${current}\n\n${para}` : para;
      currentTokens += paraTokens;
      continue;
    }
    if (current) {
      pushChunk();
      const overlapText = overlap > 0 ? takeTailByTokens(current, overlap) : "";
      current = overlapText ? `${overlapText}\n\n${para}` : para;
      currentTokens = (overlapText ? estimateTokens(overlapText) : 0) + paraTokens;
    } else {
      current = para;
      currentTokens = paraTokens;
    }
  }
  pushChunk();

  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embedTexts(inputs: string[]): Promise<number[][]> {
  const client = getOpenAIClient();
  if (!client) return [];
  const batches: string[][] = [];
  const batchSize = 96;
  for (let i = 0; i < inputs.length; i += batchSize) {
    batches.push(inputs.slice(i, i + batchSize));
  }
  const embeddings: number[][] = [];
  let totalTokens = 0;
  for (const batch of batches) {
    const batchTokens = batch.reduce((sum, text) => sum + estimateTokens(text.slice(0, 5000)), 0);
    totalTokens += batchTokens;
    const { data } = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((text) => text.slice(0, 5000)),
    });
    const sorted = [...data].sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      embeddings.push(item.embedding as number[]);
    }
  }
  if (totalTokens > 0) {
    console.log("[web-pipeline] embedding usage", {
      model: EMBEDDING_MODEL,
      totalTokens,
      estimatedCost: calculateEmbeddingCost(totalTokens),
    });
  }
  return embeddings;
}

function normalizeQueryKey(query: string): string {
  return normalizeWhitespace(query).toLowerCase();
}

function hashChunkText(text: string): string {
  return createHash("sha1").update(text || "").digest("hex");
}

async function fetchPageHtml(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  options?: { onUnlockerUsed?: () => void; allowUnlocker?: boolean; requireHtml?: boolean }
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const buildHeaders = (variant: "chrome" | "firefox") => {
      const userAgent =
        variant === "firefox"
          ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
          : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
      return {
        "user-agent": userAgent,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "upgrade-insecure-requests": "1",
      };
    };

    const attempt = async (variant: "chrome" | "firefox") => {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: buildHeaders(variant),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !response.body) {
        return { html: "", truncated: false, status: response.status, contentType };
      }
      if (options?.requireHtml && contentType && !isHtmlContentType(contentType)) {
        return { html: "", truncated: false, status: 415, contentType };
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      let html = "";
      let truncated = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > maxBytes) {
          truncated = true;
          html += decoder.decode(value, { stream: true });
          break;
        }
        html += decoder.decode(value, { stream: true });
      }
      return { html, truncated, status: response.status, contentType };
    };

    let result = await attempt("chrome");
    if (
      result.status === 403 ||
      result.status === 429 ||
      result.status === 503 ||
      (result.status === 200 && result.html.length < 200)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      console.log("[web-pipeline] fetch retry", { url, status: result.status });
      result = await attempt("firefox");
    }
    const useBrightData = process.env.BRIGHTDATA_WEB_UNLOCKER_API_KEY;
    const zoneName = process.env.BRIGHTDATA_WEB_UNLOCKER_ZONE;
    if (
      options?.allowUnlocker !== false &&
      useBrightData &&
      zoneName &&
      (result.status === 403 || result.status === 429 || result.status === 503 || result.status === 0)
    ) {
      const unlockerHtml = await fetchViaBrightDataUnlocker(
        url,
        timeoutMs,
        useBrightData,
        zoneName
      );
      if (unlockerHtml.length) {
        console.log("[web-pipeline] brightdata unlocker used", { url });
        if (options?.onUnlockerUsed) {
          options.onUnlockerUsed();
        }
        return {
          html: unlockerHtml,
          truncated: unlockerHtml.length > maxBytes,
          status: 200,
          contentType: "text/html",
        };
      }
    }
    return result;
  } catch (error) {
    console.warn("[web-pipeline] Fetch page failed", { url, error });
    return { html: "", truncated: false, status: 0, contentType: "" };
  } finally {
    clearTimeout(timeout);
  }
}

function buildJinaReaderUrl(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    const scheme = parsed.protocol === "https:" ? "https" : "http";
    const withoutScheme = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `https://r.jina.ai/${scheme}://${withoutScheme}`;
  } catch {
    return null;
  }
}

async function fetchJinaReaderText(url: string, timeoutMs: number) {
  const readerUrl = buildJinaReaderUrl(url);
  if (!readerUrl) return "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(readerUrl, {
      signal: controller.signal,
      headers: { accept: "text/plain" },
    });
    if (!response.ok) return "";
    const text = await response.text();
    return normalizeWhitespace(text);
  } catch (error) {
    console.warn("[web-pipeline] Jina reader failed", { url, error });
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function computeJsLikelihood(html: string): number {
  if (!html) return 0;
  const lower = html.toLowerCase();
  let score = 0;
  if (lower.includes("__next_data__") || lower.includes("data-reactroot")) score += 2;
  if (lower.includes("webpackjson") || lower.includes("vite")) score += 1;
  if (/<noscript>[\s\S]*?javascript[\s\S]*?<\/noscript>/i.test(html)) score += 2;
  if (/<body[^>]*>\s*<\/body>/i.test(html)) score += 2;
  const scriptCount = (html.match(/<script[\s\S]*?<\/script>/gi) ?? []).length;
  if (scriptCount >= 8) score += 1;
  return score;
}

async function fetchViaBrightDataUnlocker(
  url: string,
  timeoutMs: number,
  apiKey: string,
  zoneName: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zone: zoneName,
        url,
        format: "raw",
      }),
    });
    if (!response.ok) {
      console.warn("[web-pipeline] brightdata unlocker failed", {
        url,
        status: response.status,
      });
      return "";
    }
    const text = await response.text();
    return text;
  } catch (error) {
    console.warn("[web-pipeline] brightdata unlocker error", { url, error });
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function stripBoilerplateHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");
}

function extractTextFromHtml(html: string): string {
  if (!html) return "";
  const cleaned = stripBoilerplateHtml(
    html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
  );
  try {
    const text = convert(cleaned, {
      wordwrap: false,
      selectors: [
        { selector: "a", options: { ignoreHref: true } },
        { selector: "img", format: "skip" },
        { selector: "svg", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "noscript", format: "skip" },
      ],
    });
    return normalizeWhitespace(text);
  } catch (error) {
    console.warn("[web-pipeline] html-to-text failed", { error });
    const stripped = cleaned.replace(/<[^>]+>/g, " ");
    return normalizeWhitespace(stripped);
  }
}

function extractTableBlocks(html: string): string[] {
  if (!html) return [];
  let tables: RegExpMatchArray | null = null;
  try {
    tables = html.match(/<table[\s\S]*?<\/table>/gi);
  } catch (error) {
    console.warn("[web-pipeline] table parse failed", { error });
    tables = null;
  }
  if (!tables) return [];
  const blocks: string[] = [];
  for (const table of tables) {
    let rows: RegExpMatchArray | null = null;
    try {
      rows = table.match(/<tr[\s\S]*?<\/tr>/gi);
    } catch (error) {
      console.warn("[web-pipeline] table row parse failed", { error });
      rows = null;
    }
    if (!rows) continue;
    const lines: string[] = [];
    for (const row of rows) {
      let cells: RegExpMatchArray | null = null;
      try {
        cells = row.match(/<(td|th)[\s\S]*?<\/(td|th)>/gi);
      } catch (error) {
        console.warn("[web-pipeline] table cell parse failed", { error });
        cells = null;
      }
      if (!cells) continue;
      const cellText = cells
        .map((cell) =>
          normalizeWhitespace(cell.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
        )
        .filter(Boolean);
      if (cellText.length) {
        lines.push(cellText.join(" | "));
      }
    }
    const block = normalizeWhitespace(lines.join("\n"));
    if (block) blocks.push(block);
  }
  return blocks;
}

function extractListBlocks(html: string): string[] {
  if (!html) return [];
  let lists: RegExpMatchArray | null = null;
  try {
    lists = html.match(/<(ul|ol)[\s\S]*?<\/(ul|ol)>/gi);
  } catch (error) {
    console.warn("[web-pipeline] list parse failed", { error });
    lists = null;
  }
  if (!lists) return [];
  const blocks: string[] = [];
  for (const list of lists) {
    let items: RegExpMatchArray | null = null;
    try {
      items = list.match(/<li[\s\S]*?<\/li>/gi);
    } catch (error) {
      console.warn("[web-pipeline] list item parse failed", { error });
      items = null;
    }
    if (!items) continue;
    const lines = items
      .map((item) => normalizeWhitespace(item.replace(/<[^>]+>/g, " ").trim()))
      .filter(Boolean)
      .map((line) => `- ${line}`);
    const block = normalizeWhitespace(lines.join("\n"));
    if (block) blocks.push(block);
  }
  return blocks;
}

function extractStructuredDataText(html: string): string {
  if (!html) return "";
  const items: string[] = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const type = (entry as any)["@type"];
        const name = (entry as any).name;
        const description = (entry as any).description;
        const offers = (entry as any).offers;
        const price = offers?.price ?? offers?.priceSpecification?.price;
        const currency = offers?.priceCurrency ?? offers?.priceSpecification?.priceCurrency;
        const availability = offers?.availability;
        const segments: string[] = [];
        if (type) segments.push(`Type: ${type}`);
        if (name) segments.push(`Name: ${name}`);
        if (description) segments.push(`Description: ${String(description).slice(0, 400)}`);
        if (price || currency) segments.push(`Offer: ${price ?? ""} ${currency ?? ""}`.trim());
        if (availability) segments.push(`Availability: ${availability}`);
        if (segments.length) {
          items.push(segments.join(" | "));
        }
      }
    } catch {
      continue;
    }
  }
  if (!items.length) return "";
  const merged = items.join("\n");
  return merged.length > 2000 ? merged.slice(0, 2000) : merged;
}

type FetchPolicy = {
  allowUnlocker?: boolean;
  allowJinaFallback?: boolean;
  allowJinaOnFailure?: boolean;
  requireHtml?: boolean;
};

type FetchTask = WebPipelineResult["results"][number] & {
  fetchPolicy?: FetchPolicy;
};

type FetchedPage = WebPipelineResult["results"][number] & {
  text: string;
  tableBlocks?: string[];
  listBlocks?: string[];
  htmlLength: number;
  status: number;
  truncated: boolean;
  links?: string[];
};

type RankedChunk = WebPipelineChunk & {
  urlKey: string;
  kind: "text" | "table" | "list";
};

type ChunkBudgetOptions = {
  tokenBudget?: number;
  hardCapTokens?: number;
  minSources?: number;
};

function dedupeAndCapChunks(
  chunks: RankedChunk[],
  topK: number,
  maxPerDomain: number,
  maxPerUrl: number,
  budget?: ChunkBudgetOptions
): RankedChunk[] {
  const selected: RankedChunk[] = [];
  const domainCounts = new Map<string, number>();
  const urlCounts = new Map<string, number>();
  const seen = new Set<string>();
  let totalTokens = 0;
  const tokenBudget = budget?.tokenBudget;
  const hardCap = budget?.hardCapTokens ?? budget?.tokenBudget;
  const minSources = budget?.minSources ?? 1;
  const chunkLimit = Math.max(1, topK || 1);

  for (const chunk of chunks) {
    if (tokenBudget && totalTokens >= tokenBudget && selected.length >= minSources) break;
    if (!tokenBudget && selected.length >= chunkLimit) break;
    const domainKey = chunk.domain ?? "unknown";
    const domainCount = domainCounts.get(domainKey) ?? 0;
    if (domainCount >= maxPerDomain) continue;
    const urlCount = urlCounts.get(chunk.urlKey) ?? 0;
    if (urlCount >= maxPerUrl) continue;

    const signature = normalizeWhitespace(chunk.text).toLowerCase().slice(0, 600);
    let duplicate = false;
    if (seen.has(signature)) {
      duplicate = true;
    } else {
      for (const existing of selected) {
        const existingSig = normalizeWhitespace(existing.text).toLowerCase();
        if (existingSig.includes(signature) || signature.includes(existingSig)) {
          duplicate = true;
          break;
        }
      }
    }
    if (duplicate) continue;

    const chunkTokens = Math.max(estimateTokens(chunk.text), 1);
    seen.add(signature);
    selected.push(chunk);
    totalTokens += chunkTokens;
    domainCounts.set(domainKey, domainCount + 1);
    urlCounts.set(chunk.urlKey, urlCount + 1);

    if (tokenBudget && hardCap && totalTokens >= hardCap && selected.length >= minSources) break;
  }

  return selected;
}

async function findPersistentQueryReuse(params: {
  query: string;
  embedding: number[] | null;
  allowReuse: boolean;
}): Promise<{ serpPayload: any } | null> {
  if (!params.allowReuse) return null;
  if (!params.embedding || !params.embedding.length) return null;
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("match_web_search_queries", {
      query_embedding: params.embedding as any,
      match_threshold: PERSISTENT_QUERY_SIMILARITY_THRESHOLD,
      match_count: 3,
    });
    if (error || !Array.isArray(data) || !data.length) return null;
    const now = Date.now();
    const fresh = data.find((row: any) => {
      const lastUsed = row?.last_used_at ? new Date(row.last_used_at).getTime() : 0;
      return now - lastUsed <= PERSISTENT_QUERY_MAX_AGE_MS;
    });
    if (fresh?.serp_payload) {
      console.log("[web-pipeline] persistent query reuse hit", {
        query: params.query,
        similarity: Number(fresh.similarity ?? 0).toFixed(3),
      });
      try {
        const supabase = await supabaseServer();
        await supabase
          .from("web_search_query_catalog")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", fresh.id);
      } catch (err) {
        console.warn("[web-pipeline] failed to bump last_used_at for persistent query", err);
      }
      return { serpPayload: fresh.serp_payload };
    }
  } catch (error) {
    console.warn("[web-pipeline] persistent query reuse failed", error);
  }
  return null;
}

async function persistSearchArtifacts(params: {
  queries: string[];
  queryEmbeddings: number[][];
  serpResults: Array<{ url: string; title: string; description?: string | null; position?: number | null; domain?: string | null }>;
  selectedChunks: RankedChunk[];
  isTimeSensitive: boolean;
}) {
  try {
    const supabase = await supabaseServer();
    const nowIso = new Date().toISOString();
    const urls = params.serpResults.map((r) => r.url).filter(Boolean);

    const serpPayload = { results: params.serpResults };

    for (let i = 0; i < params.queries.length; i += 1) {
      const embedding = params.queryEmbeddings[i];
      const normalized = normalizeQueryKey(params.queries[i]);
      await supabase
        .from("web_search_query_catalog")
        .upsert({
          normalized_query: normalized,
          provider: "brightdata",
          serp_payload: serpPayload,
          urls,
          first_seen_at: nowIso,
          last_used_at: nowIso,
          is_time_sensitive: params.isTimeSensitive,
          embedding_raw: embedding ? (embedding as any) : null,
        })
        .select("id")
        .maybeSingle();
    }

    if (!params.selectedChunks.length) return;

    const chunkEmbeddings = await embedTexts(params.selectedChunks.map((chunk) => chunk.text));
    const chunkIndexByUrl = new Map<string, number>();
    for (let i = 0; i < params.selectedChunks.length; i += 1) {
      const chunk = params.selectedChunks[i];
      const chunkEmbedding = chunkEmbeddings[i];
      const url = chunk.url;
      if (!url) continue;
      const domain = chunk.domain ?? extractDomainFromUrl(url) ?? null;
      const docResult = await supabase
        .from("web_search_documents")
        .upsert({
          url,
          domain,
          title: chunk.title ?? null,
          text_content: chunk.text,
          first_seen_at: nowIso,
          last_crawled_at: nowIso,
          last_used_at: nowIso,
        })
        .select("id")
        .maybeSingle();
      const documentId = (docResult?.data as { id?: string } | null)?.id;
      if (!documentId) continue;
      const nextIndex = (chunkIndexByUrl.get(url) ?? 0) + 1;
      chunkIndexByUrl.set(url, nextIndex);
      const chunkHash = hashChunkText(chunk.text);
      await supabase.from("web_search_chunks").upsert({
        document_id: documentId,
        chunk_index: nextIndex,
        chunk_hash: chunkHash,
        chunk_text: chunk.text,
        embedding_raw: chunkEmbedding ? (chunkEmbedding as any) : null,
        last_used_at: nowIso,
      });
    }
  } catch (error) {
    console.warn("[web-pipeline] failed to persist search artifacts", error);
  }
}

async function loadStoredChunksForUrls(params: {
  urls: string[];
  maxChunksPerUrl: number;
  tokenBudget: number;
}) {
  const urls = Array.from(
    new Set(
      params.urls
        .map((u) => (typeof u === "string" ? u.trim() : ""))
        .filter(Boolean)
    )
  );
  if (!urls.length) return [] as RankedChunk[];
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("web_search_chunks")
      .select(
        `chunk_text, chunk_index, last_used_at, web_search_documents!inner(id, url, domain, title, last_crawled_at)`
      )
      .in("web_search_documents.url", urls)
      .order("chunk_index", { ascending: true });
    if (error || !Array.isArray(data)) return [];
    const now = Date.now();
    const chunks: RankedChunk[] = [];
    let tokensUsed = 0;
    const perUrlCounts = new Map<string, number>();
    const touchedDocIds: string[] = [];
    for (const row of data as any[]) {
      const doc = row.web_search_documents;
      const url = doc?.url;
      if (!url) continue;
      const lastCrawled = doc?.last_crawled_at ? new Date(doc.last_crawled_at).getTime() : 0;
      if (lastCrawled && now - lastCrawled > PERSISTENT_DOCUMENT_MAX_AGE_MS) {
        continue;
      }
      const count = perUrlCounts.get(url) ?? 0;
      if (count >= params.maxChunksPerUrl) continue;
      const text: string = row.chunk_text ?? "";
      const tokenEstimate = estimateTokens(text);
      if (tokensUsed + tokenEstimate > params.tokenBudget) break;
      tokensUsed += tokenEstimate;
      perUrlCounts.set(url, count + 1);
      if (doc?.id) touchedDocIds.push(doc.id);
      chunks.push({
        text,
        title: doc?.title ?? null,
        url,
        domain: doc?.domain ?? extractDomainFromUrl(url) ?? null,
        score: 1.0,
        urlKey: normalizeUrlKey(url),
        kind: "text",
      });
    }
    if (chunks.length) {
      try {
        const supabase = await supabaseServer();
        if (touchedDocIds.length) {
          await supabase
            .from("web_search_documents")
            .update({ last_used_at: new Date().toISOString() })
            .in("id", touchedDocIds);
        }
      } catch (err) {
        console.warn("[web-pipeline] failed to bump last_used_at for stored docs", err);
      }
      console.log("[web-pipeline] loaded stored chunks for preferred sources", {
        urls: chunks.map((c) => c.url),
        count: chunks.length,
      });
    }
    return chunks;
  } catch (error) {
    console.warn("[web-pipeline] failed to load stored chunks for urls", error);
    return [] as RankedChunk[];
  }
}
export async function runWebSearchPipeline(prompt: string, options: PipelineOptions = {}) {
  const config = { ...DEFAULTS, ...options };
  const budgetByDepth: Record<
    number,
    { tokenBudget: number; minSources: number; hardCapTokens?: number }
  > = {
    15: { tokenBudget: 6000, minSources: 4 },
    30: { tokenBudget: 10_000, minSources: 6 },
    50: { tokenBudget: 15_000, minSources: 8 },
    100: { tokenBudget: 20_000, minSources: 10, hardCapTokens: 24_000 },
  };
  let pageFetches = 0;
  let pageCacheHits = 0;
  let serpCacheHits = 0;
  let persistentQueryHit = false;
  const pipelineStart = performance.now();
  const logTiming = (stage: string, start: number, extra?: Record<string, unknown>) => {
    console.log("[web-pipeline] timing", {
      stage,
      ms: Math.round(performance.now() - start),
      ...extra,
    });
    return performance.now();
  };
  console.log("[web-pipeline] start", {
    queryCount: config.queryCount,
    serpDepth: config.serpDepth,
    fetchCandidateLimit: config.fetchCandidateLimit,
    pageLimit: config.pageLimit,
    maxTotalPages: config.maxTotalPages,
    linkDepth: config.linkDepth,
    topK: config.topK,
  });

  const queryStart = performance.now();
  const queryResult = await writeSearchQueries({
    prompt,
    count: config.queryCount,
    currentDate: options.currentDate,
    recentMessages: options.recentMessages,
    location: config.locationName
      ? { city: config.locationName, countryCode: config.countryCode }
      : config.countryCode
        ? { countryCode: config.countryCode }
        : undefined,
  });
  logTiming("query_writer", queryStart, { queries: queryResult.queries.length });
  console.log("[web-pipeline] query writer output", queryResult.queries);
  if (queryResult.useWebSearch === false && config.allowSkip !== false) {
    console.log("[web-pipeline] query writer skipped search", {
      reason: queryResult.reason ?? "Not needed",
    });
    logTiming("pipeline_total", pipelineStart);
    return {
      queries: [],
      results: [],
      chunks: [],
      sources: [],
      gate: { enoughEvidence: false },
      expanded: false,
      skipped: true,
      skipReason: queryResult.reason,
      cost: {
        serpRequests: 0,
        serpEstimatedUsd: 0,
        brightdataUnlockerRequests: 0,
        brightdataUnlockerEstimatedUsd: 0,
      },
    } satisfies WebPipelineResult;
  }

  const timeSensitivityStart = performance.now();
  const timeDecision = await assessTimeSensitivity({
    prompt,
    currentDate: options.currentDate,
  });
  logTiming("time_sensitivity", timeSensitivityStart, { timeSensitive: timeDecision.timeSensitive });
  const allowPersistentReuse = !timeDecision.timeSensitive;

  const queryEmbeddings = await embedTexts(queryResult.queries);

  const allowedDepths = [15, 30, 50, 100];
  const targetDepthHint = allowedDepths.includes(queryResult.targetDepth ?? 0)
    ? (queryResult.targetDepth as number)
    : 30;
  const chunkBudget =
    budgetByDepth[targetDepthHint] ??
    budgetByDepth[30] ?? { tokenBudget: 10_000, minSources: 6, hardCapTokens: 20_000 };
  const effectiveMaxPages = Math.max(
    config.pageLimit,
    Math.min(config.maxTotalPages ?? DEFAULTS.maxTotalPages, targetDepthHint)
  );
  const effectiveFetchCandidateLimit = Math.max(
    1,
    Math.min(config.fetchCandidateLimit ?? DEFAULTS.fetchCandidateLimit, effectiveMaxPages)
  );
  config.maxTotalPages = effectiveMaxPages;
  config.fetchCandidateLimit = effectiveFetchCandidateLimit;
  console.log("[web-pipeline] budgets", {
    targetDepthHint,
    maxTotalPages: config.maxTotalPages,
    fetchCandidateLimit: config.fetchCandidateLimit,
    chunkTokenBudget: chunkBudget.tokenBudget,
    chunkMinSources: chunkBudget.minSources,
  });

  if (config.onSearchStart) {
    const queryLabel = queryResult.queries.join(" | ").trim() || prompt;
    config.onSearchStart({ query: queryLabel, queries: queryResult.queries });
  }

  let serpRequestsTotal = 0;
  const retryOnGateFailure = options.retryOnGateFailure !== false;
  let brightdataUnlockerRequests = 0;
  let searchedCount = 0;
  const reportProgress = () => {
    if (config.onProgress) {
      config.onProgress({ type: "page_fetch_progress", searched: searchedCount });
    }
  };

  const defaultFetchPolicy: Required<FetchPolicy> = {
    allowUnlocker: true,
    allowJinaFallback: true,
    allowJinaOnFailure: false,
    requireHtml: false,
  };

  const resolveFetchPolicy = (policy?: FetchPolicy) => ({
    ...defaultFetchPolicy,
    ...policy,
  });

  const shouldExtractLinks = config.includeLinkedPages !== false;

  const fetchPages = async (results: FetchTask[]): Promise<FetchedPage[]> => {
    const pages = await Promise.all(
      results.map(async (result) => {
        try {
          const policy = resolveFetchPolicy(result.fetchPolicy);
          const cacheKey = `${PAGE_CACHE_PREFIX}${normalizeUrlKey(result.url)}`;
          const cached = await loadPageCache(cacheKey);
          const cachedHtml = typeof cached?.html === "string" ? cached.html : "";
          if (cached?.text_content && (!policy.requireHtml || cachedHtml)) {
            pageCacheHits += 1;
            console.log("[web-pipeline] page cache hit", result.url);
            searchedCount += 1;
            reportProgress();
            return {
              ...result,
              text: cached.text_content as string,
              htmlLength: cachedHtml.length,
              status: typeof cached.status === "number" ? cached.status : 0,
              truncated: Boolean(cached.truncated),
              links:
                shouldExtractLinks && cachedHtml
                  ? extractLinksFromHtml(cachedHtml, result.url)
                  : [],
            };
          }
          pageFetches += 1;
          console.log("[web-pipeline] fetching page", result.url);
          let { html, truncated, status } = await fetchPageHtml(
            result.url,
            config.pageTimeoutMs,
            config.pageMaxBytes,
            {
              onUnlockerUsed: () => {
                brightdataUnlockerRequests += 1;
              },
              allowUnlocker: policy.allowUnlocker,
              requireHtml: policy.requireHtml,
            }
          );
          let text = extractTextFromHtml(html);
          const tableBlocks = extractTableBlocks(html);
          const listBlocks = extractListBlocks(html);
          const jsLikelihood = computeJsLikelihood(html);
          const useJinaFallback = process.env.USE_JINA_READER_FALLBACK !== "0";
          const canTryJina = policy.allowJinaFallback && useJinaFallback && status !== 415;
          const shouldTryJina =
            canTryJina &&
            (policy.allowJinaOnFailure
              ? status !== 200 || (status === 200 && text.length < 80 && jsLikelihood < 2)
              : status === 200 && text.length < 80 && jsLikelihood < 2);
          if (shouldTryJina) {
            const fallbackText = await fetchJinaReaderText(result.url, config.pageTimeoutMs);
            if (fallbackText.length > text.length) {
              text = fallbackText;
              console.log("[web-pipeline] jina fallback used", {
                url: result.url,
                fallbackLength: fallbackText.length,
              });
            } else if (html.length > 2000) {
              console.log("[web-pipeline] js shell/blocked suspected", {
                url: result.url,
                htmlLength: html.length,
                textLength: text.length,
              });
            }
          }
          const structuredText = extractStructuredDataText(html);
          if (structuredText) {
            text = `${text}

Structured data:
${structuredText}`.trim();
          }
          await savePageCache(cacheKey, result.url, {
            html,
            text,
            truncated,
            status,
          });
          const links = shouldExtractLinks && html ? extractLinksFromHtml(html, result.url) : [];
          console.log("[web-pipeline] page extracted", {
            url: result.url,
            status,
            truncated,
            length: text.length,
            htmlLength: html.length,
          });
          searchedCount += 1;
          reportProgress();
          return {
            ...result,
            text,
            tableBlocks,
            listBlocks,
            htmlLength: html.length,
            status,
            truncated,
            links,
          };
        } catch (error) {
          console.warn("[web-pipeline] page processing failed", { url: result.url, error });
          searchedCount += 1;
          reportProgress();
          return {
            ...result,
            text: "",
            tableBlocks: [],
            listBlocks: [],
            htmlLength: 0,
            status: 0,
            truncated: false,
            links: [],
          };
        }
      })
    );
    return pages;
  };

  const buildChunks = (pages: FetchedPage[]) => {
    const chunks: RankedChunk[] = [];
    for (const page of pages) {
      if (!page.text && !(page.tableBlocks?.length || page.listBlocks?.length)) continue;
      const urlKey = normalizeUrlKey(page.url);
      const domain = page.domain ?? extractDomainFromUrl(page.url);
      if (page.text) {
        const slices = chunkText(page.text, config.chunkSize, config.chunkOverlap);
        for (const slice of slices) {
          chunks.push({
            text: slice,
            url: page.url,
            title: page.title,
            domain,
            score: 0,
            urlKey,
            kind: "text",
          });
        }
      }
      const tableBlocks = page.tableBlocks ?? [];
      for (const block of tableBlocks) {
        const slices = chunkText(block, config.chunkSize, config.chunkOverlap);
        for (const slice of slices) {
          chunks.push({
            text: `Table:
${slice}`,
            url: page.url,
            title: page.title,
            domain,
            score: 0,
            urlKey,
            kind: "table",
          });
        }
      }
      const listBlocks = page.listBlocks ?? [];
      for (const block of listBlocks) {
        const slices = chunkText(block, config.chunkSize, config.chunkOverlap);
        for (const slice of slices) {
          chunks.push({
            text: `List:
${slice}`,
            url: page.url,
            title: page.title,
            domain,
            score: 0,
            urlKey,
            kind: "list",
          });
        }
      }
    }
    return chunks;
  };

  const scorePageQuality = (page: { text: string; htmlLength: number }) => {
    const textLength = page.text.length;
    const ratio = page.htmlLength > 0 ? textLength / page.htmlLength : 0;
    return { textLength, ratio };
  };

  const isHighQualityPage = (page: { text: string; htmlLength: number; status?: number }) => {
    if (page.status !== undefined && page.status !== 200) return false;
    const { textLength, ratio } = scorePageQuality(page);
    return textLength >= config.minPageTextLength && ratio >= config.minContentRatio;
  };

  type LinkQueueItem = {
    url: string;
    depth: number;
    rootId: number;
    rootDomain: string | null;
  };

  const expandLinkedPages = async (
    seedPages: FetchedPage[],
    pageBudget: number,
    maxDepth: number
  ): Promise<FetchedPage[]> => {
    if (config.includeLinkedPages === false || pageBudget <= 0 || maxDepth < 1) {
      return [];
    }
    const seenUrlKeys = new Set<string>();
    for (const page of seedPages) {
      seenUrlKeys.add(normalizeUrlKey(page.url));
    }
    const rootDomains = seedPages.map((page) => page.domain ?? extractDomainFromUrl(page.url));
    const rootQueues = new Map<number, LinkQueueItem[]>();
    const rootOrder = rootDomains.map((_, index) => index);

    const enqueueLinks = (rootId: number, depth: number, urls: string[]) => {
      if (depth > maxDepth || urls.length === 0) return;
      const rootDomain = rootDomains[rootId] ?? null;
      const queue = rootQueues.get(rootId) ?? [];
      const cross: LinkQueueItem[] = [];
      const same: LinkQueueItem[] = [];
      for (const url of urls) {
        if (!isLikelyHtmlUrl(url)) continue;
        const urlKey = normalizeUrlKey(url);
        if (!urlKey || seenUrlKeys.has(urlKey)) continue;
        seenUrlKeys.add(urlKey);
        const linkDomain = extractDomainFromUrl(url);
        const isCrossDomain = Boolean(rootDomain && linkDomain && linkDomain !== rootDomain);
        const item = { url, depth, rootId, rootDomain };
        if (isCrossDomain) {
          cross.push(item);
        } else {
          same.push(item);
        }
      }
      if (cross.length || same.length) {
        queue.push(...cross, ...same);
        rootQueues.set(rootId, queue);
      }
    };

    seedPages.forEach((page, index) => {
      if (!isHighQualityPage(page)) return;
      enqueueLinks(index, 1, page.links ?? []);
    });

    const linkedPages: FetchedPage[] = [];
    let remaining = pageBudget;
    let rootCursor = 0;

    const takeNextBatch = (batchSize: number) => {
      const batch: LinkQueueItem[] = [];
      if (!rootOrder.length) return batch;
      let sweeps = 0;
      while (batch.length < batchSize) {
        let addedThisSweep = 0;
        let rootsVisited = 0;
        while (rootsVisited < rootOrder.length && batch.length < batchSize) {
          const rootId = rootOrder[rootCursor % rootOrder.length];
          rootCursor = (rootCursor + 1) % rootOrder.length;
          rootsVisited += 1;
          const queue = rootQueues.get(rootId);
          if (!queue || queue.length === 0) continue;
          const item = queue.shift();
          if (!item || item.depth > maxDepth) continue;
          batch.push(item);
          addedThisSweep += 1;
        }
        if (addedThisSweep === 0) break;
        sweeps += 1;
        if (sweeps >= 4) break;
      }
      return batch;
    };

    const appendLinkedPages = (pages: FetchedPage[]) => {
      if (remaining <= 0) return;
      const eligible: FetchedPage[] = [];
      const fallback: FetchedPage[] = [];
      for (const page of pages) {
        if (page.status !== 200) continue;
        const { textLength, ratio } = scorePageQuality(page);
        if (textLength >= config.minPageTextLength && ratio >= config.minContentRatio) {
          eligible.push(page);
        } else {
          fallback.push(page);
        }
      }
      const ordered = [
        ...eligible,
        ...fallback.sort((a, b) => b.text.length - a.text.length),
      ];
      for (const page of ordered) {
        if (remaining <= 0) break;
        linkedPages.push(page);
        remaining -= 1;
      }
    };

    while (remaining > 0) {
      const batchSize = Math.min(8, remaining);
      const batchItems = takeNextBatch(batchSize);
      if (!batchItems.length) break;
      const fetchTasks: FetchTask[] = batchItems.map((item) => {
        const domain = extractDomainFromUrl(item.url);
        const isCrossDomain = Boolean(item.rootDomain && domain && domain !== item.rootDomain);
        return {
          url: item.url,
          title: item.url,
          domain: domain ?? undefined,
          fetchPolicy: {
            allowUnlocker: !isCrossDomain,
            allowJinaOnFailure: isCrossDomain,
            requireHtml: true,
          },
        };
      });
      const fetched = await fetchPages(fetchTasks);
      appendLinkedPages(fetched);
      fetched.forEach((page, index) => {
        const meta = batchItems[index];
        if (!meta) return;
        if (!isHighQualityPage(page)) return;
        enqueueLinks(meta.rootId, meta.depth + 1, page.links ?? []);
      });
    }

    return linkedPages;
  };

  const keywordScore = (text: string, queries: string[]) => {
    const tokens: string[] = [];
    for (const query of queries) {
      const parts = query.toLowerCase().split(/[^a-z0-9]+/g);
      for (const part of parts) {
        if (part.length >= 4) {
          tokens.push(part);
        }
      }
      if (tokens.length > 200) break;
    }
    if (!tokens.length) return 0;
    const lower = text.toLowerCase();
    let hits = 0;
    for (const token of tokens) {
      if (lower.includes(token)) hits += 1;
    }
    return hits / tokens.length;
  };

  const rankChunks = async (chunks: RankedChunk[], queries: string[]) => {
    if (!chunks.length) return [];
    const overlapScored = chunks.map((chunk) => {
      const overlap = keywordScore(chunk.text, queries);
      const boost = chunk.kind === "table" || chunk.kind === "list" ? 0.2 : 0;
      return { chunk, score: overlap + boost };
    });
    const prefiltered =
      overlapScored.length > MAX_EMBED_CHUNKS
        ? overlapScored.sort((a, b) => b.score - a.score).slice(0, MAX_EMBED_CHUNKS)
        : overlapScored;
    const prefilteredChunks = prefiltered.map((item) => item.chunk);
    const queryEmbeddings = await embedTexts(queries);
    const chunkEmbeddings = await embedTexts(prefilteredChunks.map((c) => c.text));
    if (!queryEmbeddings.length || !chunkEmbeddings.length) {
      console.warn("[web-pipeline] embeddings unavailable; skipping semantic ranking.");
      return overlapScored
        .sort((a, b) => b.score - a.score)
        .map((item) => ({ ...item.chunk, score: item.score }));
    }
    return prefilteredChunks.map((chunk, index) => {
      const embedding = chunkEmbeddings[index] ?? [];
      const semantic = Math.max(...queryEmbeddings.map((q) => cosineSimilarity(q, embedding)));
      const overlap = keywordScore(chunk.text, queries);
      const boost = chunk.kind === "table" || chunk.kind === "list" ? 0.2 : 0;
      const score = semantic + overlap * 0.15 + boost;
      return { ...chunk, score };
    });
  };

  const runPass = async (
    queries: string[],
    stageLabel: "initial" | "retry",
    allowPersistentReuse: boolean,
    queryEmbeddings?: number[][]
  ) => {
    const serpStart = performance.now();
    const embeddings = queryEmbeddings && queryEmbeddings.length === queries.length
      ? queryEmbeddings
      : await embedTexts(queries);
    const serpResponses = await Promise.all(
      queries.map(async (query) => {
        const embedding = embeddings.find((_, idx) => idx === queries.indexOf(query)) ?? null;
        const persistentHit = await findPersistentQueryReuse({
          query,
          embedding: embedding ?? null,
          allowReuse: allowPersistentReuse,
        });
        if (persistentHit?.serpPayload) {
          persistentQueryHit = true;
          console.log("[web-pipeline] SERP persistent cache hit", query);
          const payload = persistentHit.serpPayload as any;
          const serpResponse = payload?.results
            ? payload
            : Array.isArray(payload)
              ? { results: payload }
              : null;
          return serpResponse ?? { results: [] };
        }
        const cacheKey = `${SERP_CACHE_PREFIX}${normalizeUrlKey(query)}`;
        const cached = await loadSerpCache(cacheKey);
        if (cached) {
          serpCacheHits += 1;
          console.log("[web-pipeline] SERP cache hit", query);
          return cached as any;
        }
        const response = await fetchGoogleOrganicSerp({
          keyword: query,
          depth: config.serpDepth,
          gl: config.countryCode ? config.countryCode.toLowerCase() : undefined,
          hl: config.languageCode ? config.languageCode.toLowerCase() : undefined,
        });
        await saveSerpCache(cacheKey, query, response);
        return response;
      })
    );
    serpRequestsTotal += queries.length;
    logTiming(stageLabel === "retry" ? "serp_fetch_retry" : "serp_fetch", serpStart, {
      queries: queries.length,
    });

    const mergeStart = performance.now();
    const mergedMap = new Map<string, WebPipelineResult["results"][number]>();
    for (let i = 0; i < serpResponses.length; i++) {
      const response = serpResponses[i];
      console.log("[web-pipeline] serp response", {
        query: queries[i],
        results: response.results.length,
        taskId: response.taskId,
      });
      for (const item of response.results) {
        const key = normalizeUrlKey(item.url);
        const existing = mergedMap.get(key);
        if (!existing || (item.position ?? Infinity) < (existing.position ?? Infinity)) {
          mergedMap.set(key, item);
        }
      }
    }

    const mergedResults = Array.from(mergedMap.values()).sort((a, b) => {
      const aPos = a.position ?? Infinity;
      const bPos = b.position ?? Infinity;
      return aPos - bPos;
    });
    logTiming(stageLabel === "retry" ? "merge_results_retry" : "merge_results", mergeStart, {
      results: mergedResults.length,
    });
    console.log("[web-pipeline] merged results", mergedResults.length);

    const remainingResults = [...mergedResults];
    const candidateResults = remainingResults.splice(0, config.fetchCandidateLimit);

    const fetchStart = performance.now();
    const fetchesBefore = pageFetches;
    const cacheHitsBefore = pageCacheHits;
    const candidatePages = await fetchPages(candidateResults);
    logTiming(stageLabel === "retry" ? "page_fetch_retry" : "page_fetch_initial", fetchStart, {
      pages: candidatePages.length,
      fetches: pageFetches - fetchesBefore,
      cacheHits: pageCacheHits - cacheHitsBefore,
    });
    const allFetchedPages = [...candidatePages];
    const filteredPages: Array<{ url: string; status: number; reason: string }> = [];
    const filterStart = performance.now();
    const goodPages = candidatePages.filter((page) => {
      if (page.status !== 200) {
        filteredPages.push({ url: page.url, status: page.status, reason: "status" });
        return false;
      }
      const { textLength, ratio } = scorePageQuality(page);
      if (textLength < config.minPageTextLength) {
        filteredPages.push({ url: page.url, status: page.status, reason: "text_length" });
        return false;
      }
      if (ratio < config.minContentRatio) {
        filteredPages.push({ url: page.url, status: page.status, reason: "content_ratio" });
        return false;
      }
      return true;
    });
    logTiming(stageLabel === "retry" ? "quality_filter_retry" : "quality_filter_initial", filterStart, {
      goodPages: goodPages.length,
    });

    let extraFetchMs = 0;
    while (goodPages.length < config.pageLimit && remainingResults.length > 0) {
      const batch = remainingResults.splice(0, Math.min(5, remainingResults.length));
      console.log("[web-pipeline] fetching extra pages", batch.map((item) => item.url));
      const extraStart = performance.now();
      const extraFetchesBefore = pageFetches;
      const extraCacheBefore = pageCacheHits;
      const extraPages = await fetchPages(batch);
      extraFetchMs += performance.now() - extraStart;
      logTiming("page_fetch_extra_batch", extraStart, {
        pages: extraPages.length,
        fetches: pageFetches - extraFetchesBefore,
        cacheHits: pageCacheHits - extraCacheBefore,
      });
      allFetchedPages.push(...extraPages);
      const extraGood = extraPages.filter((page) => {
        if (page.status !== 200) {
          filteredPages.push({ url: page.url, status: page.status, reason: "status" });
          return false;
        }
        const { textLength, ratio } = scorePageQuality(page);
        if (textLength < config.minPageTextLength) {
          filteredPages.push({ url: page.url, status: page.status, reason: "text_length" });
          return false;
        }
        if (ratio < config.minContentRatio) {
          filteredPages.push({ url: page.url, status: page.status, reason: "content_ratio" });
          return false;
        }
        return true;
      });
      goodPages.push(...extraGood);
    }
    if (extraFetchMs > 0) {
      console.log("[web-pipeline] timing", {
        stage: "page_fetch_extra_total",
        ms: Math.round(extraFetchMs),
      });
    }

    if (goodPages.length < config.pageLimit) {
      console.log("[web-pipeline] quality filter shortfall", {
        goodPages: goodPages.length,
        needed: config.pageLimit,
      });
    }
    if (filteredPages.length) {
      logCapped("[web-pipeline] filtered pages", filteredPages);
    }

    const fallbackPages = allFetchedPages
      .filter((page) => page.status === 200)
      .sort((a, b) => b.text.length - a.text.length);

    const selectedPages: FetchedPage[] = [];
    for (const page of goodPages) {
      if (selectedPages.length >= config.pageLimit) break;
      selectedPages.push(page);
    }
    for (const page of fallbackPages) {
      if (selectedPages.length >= config.pageLimit) break;
      if (!selectedPages.includes(page)) {
        selectedPages.push(page);
      }
    }

    logCapped(
      "[web-pipeline] selected pages",
      selectedPages.map((page) => page.url)
    );

    const maxTotalPages = Math.max(config.pageLimit, config.maxTotalPages ?? config.pageLimit);
    const cappedSelectedPages =
      selectedPages.length > maxTotalPages ? selectedPages.slice(0, maxTotalPages) : selectedPages;
    const remainingBudget = Math.max(0, maxTotalPages - cappedSelectedPages.length);
    const linkExpansionStart = performance.now();
    const linkedPages =
      remainingBudget > 0 && config.linkDepth > 0
        ? await expandLinkedPages(cappedSelectedPages, remainingBudget, config.linkDepth)
        : [];
    if (linkedPages.length) {
      logTiming("link_expand", linkExpansionStart, {
        added: linkedPages.length,
        totalPages: cappedSelectedPages.length + linkedPages.length,
        maxTotalPages,
      });
    }
    const combinedPages = linkedPages.length
      ? [...cappedSelectedPages, ...linkedPages]
      : cappedSelectedPages;

    const chunkStart = performance.now();
    const initialChunks = buildChunks(combinedPages);
    let preferredChunks: RankedChunk[] = [];
    if (Array.isArray(config.preferredSourceUrls) && config.preferredSourceUrls.length) {
      preferredChunks = await loadStoredChunksForUrls({
        urls: config.preferredSourceUrls,
        maxChunksPerUrl: Math.max(1, config.preferredSourceChunkLimit ?? DEFAULTS.preferredSourceChunkLimit),
        tokenBudget: Math.max(500, config.preferredSourceTokenBudget ?? DEFAULTS.preferredSourceTokenBudget),
      });
    }
    const combinedChunks = preferredChunks.length ? [...preferredChunks, ...initialChunks] : initialChunks;
    logTiming(stageLabel === "retry" ? "chunk_build_retry" : "chunk_build_initial", chunkStart, {
      chunks: combinedChunks.length,
    });
    console.log("[web-pipeline] chunks built", combinedChunks.length);

    const rankStart = performance.now();
    let rankedChunks = await rankChunks(combinedChunks, queries);
    logTiming(stageLabel === "retry" ? "rank_chunks_retry" : "rank_chunks_initial", rankStart, {
      chunks: rankedChunks.length,
    });
    rankedChunks = rankedChunks.sort((a, b) => b.score - a.score);
    let selectedChunks = dedupeAndCapChunks(
      rankedChunks,
      config.topK,
      config.maxChunksPerDomain,
      config.maxChunksPerUrl,
      chunkBudget
    );
    const tableListMin = 2;
    const tableListCandidates = rankedChunks.filter((chunk) => chunk.kind !== "text");
    if (tableListCandidates.length && selectedChunks.length) {
      const currentTableListCount = selectedChunks.filter((chunk) => chunk.kind !== "text").length;
      if (currentTableListCount < tableListMin) {
        const needed = tableListMin - currentTableListCount;
        const additions = tableListCandidates
          .filter((chunk) => !selectedChunks.some((c) => c.urlKey === chunk.urlKey && c.text === chunk.text))
          .sort((a, b) => b.score - a.score)
          .slice(0, needed);
        if (additions.length) {
          const removable = [...selectedChunks]
            .filter((chunk) => chunk.kind === "text")
            .sort((a, b) => a.score - b.score);
          for (const add of additions) {
            if (removable.length) {
              const drop = removable.shift();
              if (drop) {
                selectedChunks = selectedChunks.filter((c) => c !== drop);
              }
            }
            selectedChunks.push(add);
          }
        }
      }
    }
    logCapped(
      "[web-pipeline] top chunk scores",
      selectedChunks.map((chunk) => ({
        score: Number.isFinite(chunk.score) ? Number(chunk.score.toFixed(4)) : 0,
        url: chunk.url,
        title: chunk.title ?? null,
        kind: chunk.kind,
        preview: chunk.text.slice(0, 120),
      }))
    );
    console.log("[web-pipeline] selected chunks", selectedChunks.length);

    const gateStart = performance.now();
    let gate = await runEvidenceGate({
      prompt,
      previousQueries: queries,
      chunks: selectedChunks.map((chunk) => ({
        text: chunk.text,
        title: chunk.title,
        url: chunk.url,
      })),
    });
    logTiming(stageLabel === "retry" ? "evidence_gate_retry" : "evidence_gate_initial", gateStart, {
      enough: gate.enoughEvidence,
    });
    console.log("[web-pipeline] gate decision", gate.enoughEvidence);

    let expanded = false;
    if (!gate.enoughEvidence && remainingResults.length > 0) {
      const extra = remainingResults.splice(0, 1);
      console.log("[web-pipeline] expansion fetch", extra[0]?.url);
      const expansionFetchStart = performance.now();
      const expansionFetchesBefore = pageFetches;
      const expansionCacheBefore = pageCacheHits;
      const extraPages = await fetchPages(extra);
      logTiming("expansion_fetch", expansionFetchStart, {
        pages: extraPages.length,
        fetches: pageFetches - expansionFetchesBefore,
        cacheHits: pageCacheHits - expansionCacheBefore,
      });
      const extraEligible = extraPages.filter((page) => {
        if (page.status !== 200) return false;
        const { textLength, ratio } = scorePageQuality(page);
        return textLength >= config.minPageTextLength && ratio >= config.minContentRatio;
      });
      if (extraEligible.length === 0) {
        console.log("[web-pipeline] expansion page filtered out for low quality");
      }
      const expansionChunkStart = performance.now();
      const extraChunks = buildChunks(extraEligible.length ? extraEligible : extraPages);
      const combined = [...initialChunks, ...extraChunks];
      logTiming("expansion_chunk_build", expansionChunkStart, { chunks: combined.length });
      const expansionRankStart = performance.now();
      rankedChunks = await rankChunks(combined, queries);
      logTiming("expansion_rank", expansionRankStart, { chunks: rankedChunks.length });
      rankedChunks = rankedChunks.sort((a, b) => b.score - a.score);
      selectedChunks = dedupeAndCapChunks(
        rankedChunks,
        config.topK,
        config.maxChunksPerDomain,
        config.maxChunksPerUrl,
        chunkBudget
      );
      const expansionGateStart = performance.now();
      gate = await runEvidenceGate({
        prompt,
        previousQueries: queries,
        chunks: selectedChunks.map((chunk) => ({
          text: chunk.text,
          title: chunk.title,
          url: chunk.url,
        })),
      });
      logTiming("expansion_gate", expansionGateStart, { enough: gate.enoughEvidence });
      expanded = true;
      console.log("[web-pipeline] gate decision after expansion", gate.enoughEvidence);
    }

    const sources = Array.from(
      new Map(
        selectedChunks.map((chunk) => [chunk.url, { title: chunk.title ?? chunk.url, url: chunk.url }])
      ).values()
    );

    return {
      queries,
      results: mergedResults,
      chunks: selectedChunks,
      sources,
      gate,
      expanded,
      selectedPagesCount: combinedPages.length,
    };
  };

  let usedQueries = [...queryResult.queries];
  let pass = await runPass(queryResult.queries, "initial", allowPersistentReuse, queryEmbeddings);
  if (
    !pass.gate.enoughEvidence &&
    retryOnGateFailure &&
    Array.isArray(pass.gate.suggestedQueries) &&
    pass.gate.suggestedQueries.length
  ) {
    const retryQueries = pass.gate.suggestedQueries.slice(0, 2);
    const retryPass = await runPass(retryQueries, "retry", allowPersistentReuse);
    usedQueries = [...usedQueries, ...retryQueries];
    if (retryPass.gate.enoughEvidence || retryPass.chunks.length >= pass.chunks.length) {
      pass = { ...retryPass, expanded: pass.expanded || retryPass.expanded };
    }
  }

  const serpEstimatedUsd = serpRequestsTotal * BRIGHTDATA_SERP_COST_USD;
  const brightdataEstimatedUsd = brightdataUnlockerRequests * BRIGHTDATA_UNLOCKER_COST_USD;

  console.log("[web-pipeline] cost summary", {
    serpRequests: serpRequestsTotal,
    serpEstimatedUsd: Number.isFinite(serpEstimatedUsd) ? serpEstimatedUsd : 0,
    brightdataUnlockerRequests,
    brightdataEstimatedUsd: Number.isFinite(brightdataEstimatedUsd) ? brightdataEstimatedUsd : 0,
    pageFetches,
    pageCacheHits,
    pagesSelected: pass.selectedPagesCount,
    chunksSelected: pass.chunks.length,
  });
  logTiming("pipeline_total", pipelineStart);
  const persistEmbeddings = await embedTexts(usedQueries);
  await persistSearchArtifacts({
    queries: usedQueries,
    queryEmbeddings: persistEmbeddings,
    serpResults: pass.results,
    selectedChunks: pass.chunks,
    isTimeSensitive: timeDecision.timeSensitive,
  });

  return {
    queries: usedQueries,
    results: pass.results,
    chunks: pass.chunks,
    sources: pass.sources,
    gate: pass.gate,
    expanded: pass.expanded,
    timeSensitive: timeDecision.timeSensitive,
    reusedPersistentQuery: persistentQueryHit || serpCacheHits > 0,
    serpCacheHits,
    pageCacheHits,
    cost: {
      serpRequests: serpRequestsTotal,
      serpEstimatedUsd: serpEstimatedUsd,
      brightdataUnlockerRequests,
      brightdataUnlockerEstimatedUsd: brightdataEstimatedUsd,
    },
  } satisfies WebPipelineResult;
}
