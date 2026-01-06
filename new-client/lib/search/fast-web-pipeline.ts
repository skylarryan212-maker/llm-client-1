import { convert } from "html-to-text";
import { extractDomainFromUrl } from "@/lib/metadata";
import {
  fetchGoogleOrganicSerp,
  type BrightDataOrganicResult,
} from "@/lib/search/brightdata-serp";
import { writeSearchQueries } from "@/lib/search/search-llm";

export type WebPipelineChunk = {
  text: string;
  url: string;
  title: string;
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
  collectedUrls?: string[];
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

type PipelineOptions = {
  currentDate?: string;
  locationName?: string;
  languageCode?: string;
  countryCode?: string;
  recentMessages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  preferredSourceUrls?: string[];
  allowSkip?: boolean;
  queryCount?: number;
  onSearchStart?: (event: { query: string; queries: string[] }) => void;
  onProgress?: (event: { type: "page_fetch_progress"; searched: number }) => void;
};

type SourceCard = {
  url: string;
  title: string;
  description?: string | null;
  position?: number | null;
  domain: string | null;
  status: "ok" | "blocked" | "timeout" | "error";
  blockedReason?: string | null;
  text: string;
  relevanceScore: number;
};

const TARGET_USABLE_PAGES = 10;
const MAX_SERP_RESULTS = 30;
const DEFAULT_QUERY_COUNT = 1;
const FETCH_CONCURRENCY = 12;
const SERP_RESULTS_UNIT = 10;
const PAGE_TIMEOUT_MS = 3_000;
const MAX_PAGE_CHARS = 4_000;
const EXCERPT_WORDS = 400;
const KEYWORD_WINDOW_WORDS = 120;
const BRIGHTDATA_SERP_COST_USD = 0.0015;
const BRIGHTDATA_UNLOCKER_COST_USD = 0;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "to",
  "for",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "about",
  "as",
  "into",
  "over",
  "after",
  "than",
  "out",
  "up",
  "down",
  "off",
  "near",
  "latest",
  "today",
  "new",
  "recent",
]);

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractKeywords(prompt: string): string[] {
  const cleaned = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word))
    .slice(0, 20);
  return Array.from(new Set(cleaned));
}

function buildSearchQuery(prompt: string, currentDate?: string): string {
  const keywords = extractKeywords(prompt);
  const hasRecencyCue = /\b(latest|today|recent|new|now|this week|this month)\b/i.test(prompt);
  const recencySuffix =
    hasRecencyCue && currentDate ? ` ${new Date(currentDate).getFullYear()}` : hasRecencyCue ? " latest" : "";
  const base = keywords.join(" ");
  const query = normalizeWhitespace(`${base || prompt}${recencySuffix}`);
  return query || prompt.trim();
}

function computeRelevanceScore(title: string, text: string, queryKeywords: string[]): number {
  if (!queryKeywords.length) return 0;
  const haystack = `${title.toLowerCase()} ${text.toLowerCase()}`;
  let score = 0;
  for (const kw of queryKeywords) {
    if (!kw) continue;
    const occurrences = haystack.split(kw).length - 1;
    score += occurrences > 0 ? occurrences : 0;
  }
  return score;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function makeStartExcerpt(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.slice(0, EXCERPT_WORDS).join(" ");
}

function makeKeywordExcerpt(text: string, keywords: string[]): string {
  if (!keywords.length) {
    return makeStartExcerpt(text);
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const lowerWords = words.map((w) => w.toLowerCase());
  const windowSize = Math.min(KEYWORD_WINDOW_WORDS, words.length);
  let bestScore = -1;
  let bestStart = 0;

  for (let i = 0; i <= lowerWords.length - windowSize; i++) {
    const window = lowerWords.slice(i, i + windowSize);
    const matchCount = window.reduce((count, word) => count + (keywords.includes(word) ? 1 : 0), 0);
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestStart = i;
    }
  }

  const start = Math.max(0, bestStart - Math.floor((EXCERPT_WORDS - windowSize) / 2));
  return words.slice(start, start + EXCERPT_WORDS).join(" ");
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function extractPageText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetchWithTimeout(url, timeoutMs);
  if (!response.ok || !response.headers.get("content-type")?.includes("text")) {
    throw new Error(`Fetch failed: ${response.status}`);
  }
  const html = await response.text();
  const text = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" },
    ],
  });
  return truncateText(normalizeWhitespace(text), MAX_PAGE_CHARS);
}

function detectBlockReason(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("captcha")) return "captcha";
  if (lower.includes("subscribe") || lower.includes("sign in") || lower.includes("log in")) return "auth_wall";
  if (lower.includes("access denied") || lower.includes("forbidden")) return "access_denied";
  if (lower.includes("enable javascript")) return "js_required";
  return null;
}

async function fetchSourceCard(
  result: BrightDataOrganicResult,
  queryKeywords: string[]
): Promise<SourceCard> {
  const url = result.url;
  const domain = result.domain ?? extractDomainFromUrl(url) ?? null;
  const title = result.title || url;
  try {
    const text = await extractPageText(url, PAGE_TIMEOUT_MS);
    const blockedReason = detectBlockReason(text);
    if (blockedReason) {
      return {
        url,
        domain,
        title,
        description: result.description,
        position: result.position,
        status: "blocked",
        blockedReason,
        text: "",
        relevanceScore: 0,
      };
    }
    const score = computeRelevanceScore(title, text, queryKeywords);
    return {
      url,
      domain,
      title,
      description: result.description,
      position: result.position,
      status: "ok",
      text,
      relevanceScore: score,
    };
  } catch (error: any) {
    const status: SourceCard["status"] = error?.name === "AbortError" ? "timeout" : "error";
    return {
      url,
      domain,
      title,
      description: result.description,
      position: result.position,
      status,
      blockedReason: null,
      text: "",
      relevanceScore: 0,
    };
  }
}

function selectSerpResults(
  results: BrightDataOrganicResult[],
  maxItems: number
): BrightDataOrganicResult[] {
  const output: BrightDataOrganicResult[] = [];
  for (const item of results) {
    if (!item?.url || typeof item.url !== "string") continue;
    const domain = item.domain ?? extractDomainFromUrl(item.url) ?? "";
    if (!domain) continue;
    output.push({ ...item, domain });
    if (output.length >= maxItems) break;
  }
  return output;
}

async function collectSources(
  serpResults: BrightDataOrganicResult[],
  queryKeywords: string[],
  onProgress?: PipelineOptions["onProgress"]
): Promise<SourceCard[]> {
  const collected: SourceCard[] = [];
  let usableCount = 0;
  let cursor = 0;
  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, serpResults.length) }, async () => {
    while (true) {
      if (usableCount >= TARGET_USABLE_PAGES) return;
      const current = cursor;
      cursor += 1;
      if (current >= serpResults.length) return;
      const card = await fetchSourceCard(serpResults[current], queryKeywords);
      collected.push(card);
      if (card.status === "ok" && card.text) {
        usableCount += 1;
      }
      if (onProgress) {
        onProgress({ type: "page_fetch_progress", searched: collected.length });
      }
    }
  });
  await Promise.all(workers);
  return collected;
}

function selectEvidenceSources(cards: SourceCard[], serpCount: number): SourceCard[] {
  const okCards = cards.filter((card) => card.status === "ok" && card.text);
  if (!okCards.length) return [];
  const sorted = okCards.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const limit = Math.max(1, Math.min(sorted.length, Math.floor(serpCount / 2) || 1));
  return sorted.slice(0, limit);
}

export async function runWebSearchPipeline(
  prompt: string,
  options: PipelineOptions = {}
): Promise<WebPipelineResult> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return {
      queries: [],
      results: [],
      chunks: [],
      sources: [],
      gate: { enoughEvidence: false },
      expanded: false,
      skipped: true,
      skipReason: "Empty prompt",
    };
  }

  const fallbackQuery = buildSearchQuery(trimmedPrompt, options.currentDate);
  const queryCount = Math.max(1, options.queryCount ?? DEFAULT_QUERY_COUNT);
  const location = options.locationName
    ? { city: options.locationName, countryCode: options.countryCode }
    : options.countryCode
      ? { countryCode: options.countryCode }
      : undefined;

  console.log("[fast-web-pipeline] invoking query writer", {
    prompt: trimmedPrompt,
    fallbackQuery,
    queryCount,
  });
  let queryWriterResult: Awaited<ReturnType<typeof writeSearchQueries>> | null = null;
  try {
    queryWriterResult = await writeSearchQueries({
      prompt: trimmedPrompt,
      count: queryCount,
      currentDate: options.currentDate,
      recentMessages: options.recentMessages,
      location,
    });
  } catch (error) {
    console.warn("[fast-web-pipeline] query writer failed", error);
  }

  const shouldUseWebSearch = queryWriterResult?.useWebSearch ?? true;
  const canSkip = options.allowSkip !== false;

  const rawWriterQueries = Array.isArray(queryWriterResult?.queries)
    ? queryWriterResult.queries
    : [];
  const cleanedWriterQueries = rawWriterQueries
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
  const queries: string[] = cleanedWriterQueries.slice(0, queryCount);
  while (queries.length < queryCount) {
    queries.push(fallbackQuery);
  }

  const requestedResultCount = queryWriterResult?.resultCount === 20 ? 20 : 10;
  const resultsPerQuery = queries.length > 1 ? 10 : requestedResultCount;

  console.log("[fast-web-pipeline] query writer result", {
    shouldUseWebSearch,
    reason: queryWriterResult?.reason,
    queries,
    resultsPerQuery,
  });
  if (!shouldUseWebSearch && canSkip) {
    const reason = queryWriterResult?.reason ?? "Search not needed";
    console.log("[fast-web-pipeline] skipping search", { reason, queries, resultsPerQuery });
    return {
      queries,
      results: [],
      chunks: [],
      sources: [],
      gate: { enoughEvidence: false },
      expanded: false,
      skipped: true,
      skipReason: reason,
      timeSensitive: false,
      reusedPersistentQuery: false,
      serpCacheHits: 0,
      pageCacheHits: 0,
      cost: {
        serpRequests: 0,
        serpEstimatedUsd: 0,
        brightdataUnlockerRequests: 0,
        brightdataUnlockerEstimatedUsd: BRIGHTDATA_UNLOCKER_COST_USD,
      },
    };
  }

  const queryLabel = queries.join(" | ").trim() || trimmedPrompt;
  options.onSearchStart?.({ query: queryLabel, queries });

  const allSerpResults: BrightDataOrganicResult[] = [];
  let serpRequests = 0;
  for (const query of queries) {
    const serpResponse = await fetchGoogleOrganicSerp({
      keyword: query,
      depth: resultsPerQuery,
      gl: options.countryCode,
      hl: options.languageCode,
    });
    serpRequests += 1;
    const count = Array.isArray(serpResponse.results) ? serpResponse.results.length : 0;
    console.log("[fast-web-pipeline] fetched SERP", {
      query,
      serpRequests,
      results: count,
      requested: resultsPerQuery,
    });
    if (Array.isArray(serpResponse.results)) {
      allSerpResults.push(...serpResponse.results);
    }
  }
  const resultMultiplier = resultsPerQuery / SERP_RESULTS_UNIT;
  const serpEstimatedUsd = serpRequests * resultMultiplier * BRIGHTDATA_SERP_COST_USD;

  const maxSerpItems = Math.min(MAX_SERP_RESULTS, resultsPerQuery * queries.length);
  const serpResults = selectSerpResults(allSerpResults, maxSerpItems);
  console.log("[fast-web-pipeline] SERP selection", {
    candidateResults: allSerpResults.length,
    selected: serpResults.length,
    serpRequests,
    resultsPerQuery,
  });

  if (!serpResults.length) {
    console.log("[fast-web-pipeline] no SERP results", { queries, resultsPerQuery });
    return {
      queries,
      results: [],
      chunks: [],
      sources: [],
      gate: { enoughEvidence: false },
      expanded: false,
      skipped: options.allowSkip === true,
      skipReason: options.allowSkip ? "No SERP results" : undefined,
      timeSensitive: false,
      reusedPersistentQuery: false,
      serpCacheHits: 0,
      pageCacheHits: 0,
      cost: {
        serpRequests,
        serpEstimatedUsd,
        brightdataUnlockerRequests: 0,
        brightdataUnlockerEstimatedUsd: BRIGHTDATA_UNLOCKER_COST_USD,
      },
    };
  }

  const queryKeywords = extractKeywords(queries.join(" "));
  const collected = await collectSources(serpResults, queryKeywords, options.onProgress);
  const usable = collected.filter((card) => card.status === "ok" && card.text).slice(0, TARGET_USABLE_PAGES);
  const evidenceCards = selectEvidenceSources(usable, serpResults.length);

  const chunks: WebPipelineChunk[] = [];
  for (const card of evidenceCards) {
    const excerptA = makeStartExcerpt(card.text);
    const excerptB = makeKeywordExcerpt(card.text, queryKeywords);
    if (excerptA) {
      chunks.push({
        text: excerptA,
        url: card.url,
        title: card.title,
        domain: card.domain,
        score: card.relevanceScore,
      });
    }
    if (excerptB) {
      chunks.push({
        text: excerptB,
        url: card.url,
        title: card.title,
        domain: card.domain,
        score: card.relevanceScore,
      });
    }
  }

  const sources = evidenceCards.map((card) => ({ title: card.title, url: card.url }));
  console.log("[fast-web-pipeline] returning result", {
    queries,
    totalSERPResults: serpResults.length,
    chunks: chunks.length,
    serpRequests,
    resultsPerQuery,
    serpEstimatedUsd,
  });

  return {
    queries,
    results: serpResults.map((r) => ({
      url: r.url,
      title: r.title,
      description: r.description ?? null,
      position: r.position ?? null,
      domain: r.domain ?? null,
    })),
    chunks,
    sources,
    gate: { enoughEvidence: evidenceCards.length > 0 },
    expanded: false,
    skipped: false,
    collectedUrls: collected.map((card) => card.url),
    timeSensitive: false,
    reusedPersistentQuery: false,
    serpCacheHits: 0,
    pageCacheHits: 0,
    cost: {
      serpRequests,
      serpEstimatedUsd,
      brightdataUnlockerRequests: 0,
      brightdataUnlockerEstimatedUsd: BRIGHTDATA_UNLOCKER_COST_USD,
    },
  };
}
