import { performance } from "perf_hooks";
import { callDeepInfraLlama } from "@/lib/deepInfraLlama";
import { calculateCost } from "@/lib/pricing";

export type QueryWriterResult = {
  queries: string[];
  useWebSearch: boolean;
  reason?: string;
  targetDepth?: number;
};

export type QueryAndTimeResult = {
  queries: string[];
  useWebSearch: boolean;
  reason?: string;
  targetDepth?: number;
  timeSensitive: boolean;
  timeReason?: string;
};

function logDeepInfraUsage(label: string, model: string, usage?: { input_tokens: number; output_tokens: number }) {
  if (!usage) return;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const estimatedCost = calculateCost(model, inputTokens, 0, outputTokens);
  console.log(`[search-llm] ${label} usage`, {
    model,
    inputTokens,
    outputTokens,
    estimatedCost,
  });
}

export async function writeSearchQueries(params: {
  prompt: string;
  count?: number;
  currentDate?: string;
  recentMessages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  location?: { city?: string; countryCode?: string };
}): Promise<QueryWriterResult> {
  const count = params.count ?? 2;
  const systemPrompt = `You are a search query writer for a web search pipeline.
Return JSON only with this shape:
{ "useWebSearch": boolean, "queries": string[], "reason": string, "targetDepth": number }
Rules:
- Decide whether web search will materially help answer the prompt.
- If web search will NOT help (e.g., purely conversational, personal preference, creative writing, general advice, or internal app help without external facts), set "useWebSearch": false and return an empty queries array.
- If web search WILL help (facts, stats, current events, prices, schedules, citations), set "useWebSearch": true and produce ${count} concise queries.
- Use the prompt as the primary signal. Use recent messages only to disambiguate.
- If the prompt implies recency, use the provided current date to anchor queries.
- Prefer breadth across queries: cover different angles of the same question.
- For technical questions about extraction/pipelines (e.g., non-HTML, PDF, JS rendering, OCR, indexing),
  include method-specific queries (JavaScript rendering/indexing, PDF/OCR, and search engine indexing).
- Queries should be short, specific, and not include quotes.
- If "useWebSearch" is false, include a short reason in "reason" (max 12 words).
- Choose a "targetDepth" from [15, 30, 50, 100] to signal how many URLs to fetch overall (including any crawl). Use lower for narrow/urgent/local questions; higher for broad research or long-tail topics. If unsure, pick 30.
- Do not include commentary or extra fields.`;

  const recentMessageBlock = Array.isArray(params.recentMessages) && params.recentMessages.length
    ? params.recentMessages
        .slice(-6)
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join("\n")
    : "None";

  const userContent = [
    `Current date: ${params.currentDate ?? "Unknown"}`,
    params.location?.city
      ? `User location: ${params.location.city}${params.location.countryCode ? ` (${params.location.countryCode})` : ""}`
      : params.location?.countryCode
        ? `User country: ${params.location.countryCode}`
        : "User location: Unknown",
    "Recent messages (for context only):",
    recentMessageBlock,
    "User prompt:",
    params.prompt,
  ].join("\n");

  const start = performance.now();
  const { text, usage } = await callDeepInfraLlama({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    schemaName: "query_writer",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        useWebSearch: { type: "boolean" },
        queries: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
        targetDepth: { type: "number" },
      },
      required: ["useWebSearch", "queries"],
    },
    temperature: 0.2,
    model: "openai/gpt-oss-20b",
    enforceJson: true,
    maxTokens: 200,
    extraParams: { reasoning_effort: "low" },
  });
  console.log("[search-llm] query-writer timing", {
    ms: Math.round(performance.now() - start),
  });
  logDeepInfraUsage("query-writer", "openai/gpt-oss-20b", usage);

  let parsed: QueryWriterResult | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const shouldUseWebSearch = typeof parsed?.useWebSearch === "boolean" ? parsed.useWebSearch : true;
  if (!shouldUseWebSearch) {
    return {
      queries: [],
      useWebSearch: false,
      reason: typeof parsed?.reason === "string" ? parsed.reason.trim() : "Not needed",
    };
  }

  const rawQueries = Array.isArray(parsed?.queries) ? parsed.queries : [];
  const cleaned = rawQueries
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter((q) => q.length > 0);

  const unique: string[] = [];
  for (const query of cleaned) {
    if (!unique.some((existing) => existing.toLowerCase() === query.toLowerCase())) {
      unique.push(query);
    }
  }

  const finalQueries = unique.length ? unique.slice(0, count) : [];
  while (finalQueries.length < count) {
    finalQueries.push(params.prompt.trim());
  }

  const allowedDepths = [15, 30, 50, 100];
  const parsedDepth = typeof parsed?.targetDepth === "number" ? Math.round(parsed.targetDepth) : NaN;
  const targetDepth = allowedDepths.find((d) => d === parsedDepth);

  return { queries: finalQueries, useWebSearch: true, targetDepth };
}

export type GateDecision = {
  enoughEvidence: boolean;
  suggestedQueries?: string[];
};

export type TimeSensitivityDecision = {
  timeSensitive: boolean;
  reason?: string;
};

export async function runEvidenceGate(params: {
  prompt: string;
  chunks: Array<{ text: string; title?: string | null; url?: string | null }>;
  previousQueries?: string[];
}): Promise<GateDecision> {
  const systemPrompt = `You are an evidence gate for a search pipeline.
Return JSON only with:
{ "enoughEvidence": boolean, "suggestedQueries": string[] }
Rules:
- If the provided chunks contain enough evidence to answer the prompt, return true.
- If the chunks are too thin, off-topic, or missing key details, return false.
- If you return false, propose up to 2 concise alternative queries that try new angles and avoid the previous queries/sources.
- No extra fields or commentary.`;

  const chunkSummary = params.chunks
    .map((chunk, index) => {
      const title = chunk.title ? `Title: ${chunk.title}` : "";
      const url = chunk.url ? `URL: ${chunk.url}` : "";
      const content = chunk.text.length > 1200 ? `${chunk.text.slice(0, 1200)}...` : chunk.text;
      return `Chunk ${index + 1}\n${title}\n${url}\n${content}`.trim();
    })
    .join("\n\n");

  const start = performance.now();
  const { text, usage } = await callDeepInfraLlama({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Prompt:\n${params.prompt}\n\nPrevious queries:\n${
          params.previousQueries?.length ? params.previousQueries.join("\n") : "None"
        }\n\nChunks:\n${chunkSummary}`,
      },
    ],
    schemaName: "evidence_gate",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enoughEvidence: { type: "boolean" },
        suggestedQueries: { type: "array", items: { type: "string" } },
      },
      required: ["enoughEvidence", "suggestedQueries"],
    },
    temperature: 0.2,
    model: "openai/gpt-oss-20b",
    enforceJson: true,
    maxTokens: 120,
    extraParams: { reasoning_effort: "low" },
  });
  console.log("[search-llm] evidence-gate timing", {
    ms: Math.round(performance.now() - start),
  });
  logDeepInfraUsage("evidence-gate", "openai/gpt-oss-20b", usage);

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.enoughEvidence === "boolean") {
      const raw = Array.isArray(parsed?.suggestedQueries) ? parsed.suggestedQueries : [];
      const cleaned = raw
        .map((q: unknown) => (typeof q === "string" ? q.trim() : ""))
        .filter(Boolean);
      return { enoughEvidence: parsed.enoughEvidence, suggestedQueries: cleaned.slice(0, 2) };
    }
  } catch {
    // fall through
  }

  return { enoughEvidence: false, suggestedQueries: [] };
}

export async function assessTimeSensitivity(params: {
  prompt: string;
  currentDate?: string;
}): Promise<TimeSensitivityDecision> {
  const systemPrompt = `You classify whether a user question needs fresh/real-time data.
Return JSON only:
{ "timeSensitive": boolean, "reason": string }
Rules:
- Our system already caches web results for 24 hours. Only mark timeSensitive=true if data older than ~24 hours is likely insufficient (e.g., live scores, breaking news, current traffic/stock/flight status, “right now” weather).
- For stable schedules within a day, routine recipes/how-tos, evergreen facts, or yesterday’s news being acceptable, return false.
- timeSensitive=true when the user likely wants the latest schedules/dates/prices/news/rankings/releases/scores/weather that change intra-day and need fresh fetch.
- Otherwise, return false. Keep reason brief (<= 12 words).`;

  const start = performance.now();
  const { text, usage } = await callDeepInfraLlama({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Current date: ${params.currentDate ?? "Unknown"}\nUser prompt: ${params.prompt}`,
      },
    ],
    schemaName: "time_sensitivity_classifier",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        timeSensitive: { type: "boolean" },
        reason: { type: "string" },
      },
      required: ["timeSensitive"],
    },
    temperature: 0.1,
    model: "openai/gpt-oss-20b",
    enforceJson: true,
    maxTokens: 80,
    extraParams: { reasoning_effort: "low" },
  });
  console.log("[search-llm] time-sensitivity timing", {
    ms: Math.round(performance.now() - start),
  });
  logDeepInfraUsage("time-sensitivity", "openai/gpt-oss-20b", usage);

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.timeSensitive === "boolean") {
      return {
        timeSensitive: parsed.timeSensitive,
        reason: typeof parsed?.reason === "string" ? parsed.reason.trim() : undefined,
      };
    }
  } catch {
    // fall through
  }
  return { timeSensitive: false };
}

export async function writeSearchQueriesAndTime(params: {
  prompt: string;
  count?: number;
  currentDate?: string;
  recentMessages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  location?: { city?: string; countryCode?: string };
}): Promise<QueryAndTimeResult> {
  const count = params.count ?? 2;
  const systemPrompt = `You decide if web search is needed AND write queries AND classify time-sensitivity.
Return ONLY JSON:
{
  "useWebSearch": boolean,
  "queries": string[],
  "reason": string,
  "targetDepth": number,
  "timeSensitive": boolean,
  "timeReason": string
}
Rules:
- If web search will NOT help, set useWebSearch=false, queries=[], include a short reason.
- If web search WILL help, set useWebSearch=true and produce ${count} concise queries.
- Choose targetDepth from [15,30,50,100]; lower for narrow/local/urgent, higher for broad research.
- timeSensitive=true only when data older than ~24h is insufficient (live scores, breaking news, current traffic/stock/flight status, “right now” weather); otherwise false.
- Keep reasons short (<=12 words). No extra fields.`;

  const recentMessageBlock = Array.isArray(params.recentMessages) && params.recentMessages.length
    ? params.recentMessages
        .slice(-6)
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join("\n")
    : "None";

  const userContent = [
    `Current date: ${params.currentDate ?? "Unknown"}`,
    params.location?.city
      ? `User location: ${params.location.city}${params.location.countryCode ? ` (${params.location.countryCode})` : ""}`
      : params.location?.countryCode
        ? `User country: ${params.location.countryCode}`
        : "User location: Unknown",
    "Recent messages (for context only):",
    recentMessageBlock,
    "User prompt:",
    params.prompt,
  ].join("\n");

  const start = performance.now();
  const { text, usage } = await callDeepInfraLlama({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    schemaName: "query_and_time",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        useWebSearch: { type: "boolean" },
        queries: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
        targetDepth: { type: "number" },
        timeSensitive: { type: "boolean" },
        timeReason: { type: "string" },
      },
      required: ["useWebSearch", "queries", "timeSensitive"],
    },
    temperature: 0.2,
    model: "openai/gpt-oss-20b",
    enforceJson: true,
    maxTokens: 220,
    extraParams: { reasoning_effort: "low" },
  });
  console.log("[search-llm] query-and-time timing", {
    ms: Math.round(performance.now() - start),
  });
  logDeepInfraUsage("query-and-time", "openai/gpt-oss-20b", usage);

  let parsed: QueryAndTimeResult | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const shouldUseWebSearch = typeof parsed?.useWebSearch === "boolean" ? parsed.useWebSearch : true;
  const rawQueries = Array.isArray(parsed?.queries) ? parsed.queries : [];
  const cleaned = rawQueries
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter((q) => q.length > 0);

  const unique: string[] = [];
  for (const query of cleaned) {
    if (!unique.some((existing) => existing.toLowerCase() === query.toLowerCase())) {
      unique.push(query);
    }
  }
  const finalQueries = unique.length ? unique.slice(0, count) : [];
  while (finalQueries.length < count) {
    finalQueries.push(params.prompt.trim());
  }

  const allowedDepths = [15, 30, 50, 100];
  const parsedDepth = typeof parsed?.targetDepth === "number" ? Math.round(parsed.targetDepth) : NaN;
  const targetDepth = allowedDepths.find((d) => d === parsedDepth);

  return {
    queries: finalQueries,
    useWebSearch: shouldUseWebSearch,
    reason: parsed?.reason,
    targetDepth,
    timeSensitive: Boolean(parsed?.timeSensitive),
    timeReason: parsed?.timeReason,
  };
}
