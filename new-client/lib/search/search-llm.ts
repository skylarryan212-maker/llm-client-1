import { callDeepInfraLlama } from "@/lib/deepInfraLlama";
import { calculateCost } from "@/lib/pricing";

export type QueryWriterResult = {
  queries: string[];
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
}): Promise<QueryWriterResult> {
  const count = params.count ?? 2;
  const systemPrompt = `You are a search query writer for a web search pipeline.
Return JSON only with this shape:
{ "queries": string[] }
Rules:
- Produce ${count} concise queries.
- Use the prompt as the primary signal. Use recent messages only to disambiguate.
- If the prompt implies recency, use the provided current date to anchor queries.
- Prefer breadth across queries: cover different angles of the same question.
- For technical questions about extraction/pipelines (e.g., non-HTML, PDF, JS rendering, OCR, indexing),
  include method-specific queries (JavaScript rendering/indexing, PDF/OCR, and search engine indexing).
- Queries should be short, specific, and not include quotes.
- Do not include commentary or extra fields.`;

  const recentMessageBlock = Array.isArray(params.recentMessages) && params.recentMessages.length
    ? params.recentMessages
        .slice(-6)
        .map((msg) => `${msg.role}: ${msg.content}`)
        .join("\n")
    : "None";

  const userContent = [
    `Current date: ${params.currentDate ?? "Unknown"}`,
    "Recent messages (for context only):",
    recentMessageBlock,
    "User prompt:",
    params.prompt,
  ].join("\n");

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
        queries: { type: "array", items: { type: "string" } },
      },
      required: ["queries"],
    },
    temperature: 0.2,
    model: "openai/gpt-oss-20b",
    enforceJson: true,
    maxTokens: 200,
    extraParams: { reasoning_effort: "low" },
  });
  logDeepInfraUsage("query-writer", "openai/gpt-oss-20b", usage);

  let parsed: QueryWriterResult | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const rawQueries = Array.isArray(parsed?.queries) ? parsed!.queries : [];
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

  return { queries: finalQueries };
}

export type GateDecision = {
  enoughEvidence: boolean;
};

export async function runEvidenceGate(params: {
  prompt: string;
  chunks: Array<{ text: string; title?: string | null; url?: string | null }>;
}): Promise<GateDecision> {
  const systemPrompt = `You are an evidence gate for a search pipeline.
Return JSON only with:
{ "enoughEvidence": boolean }
Rules:
- If the provided chunks contain enough evidence to answer the prompt, return true.
- If the chunks are too thin, off-topic, or missing key details, return false.
- No extra fields or commentary.`;

  const chunkSummary = params.chunks
    .map((chunk, index) => {
      const title = chunk.title ? `Title: ${chunk.title}` : "";
      const url = chunk.url ? `URL: ${chunk.url}` : "";
      const content = chunk.text.length > 1200 ? `${chunk.text.slice(0, 1200)}...` : chunk.text;
      return `Chunk ${index + 1}\n${title}\n${url}\n${content}`.trim();
    })
    .join("\n\n");

  const { text, usage } = await callDeepInfraLlama({
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Prompt:\n${params.prompt}\n\nChunks:\n${chunkSummary}`,
      },
    ],
    schemaName: "evidence_gate",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enoughEvidence: { type: "boolean" },
      },
      required: ["enoughEvidence"],
    },
    temperature: 0.2,
    model: "openai/gpt-oss-20b",
    enforceJson: true,
    maxTokens: 120,
    extraParams: { reasoning_effort: "low" },
  });
  logDeepInfraUsage("evidence-gate", "openai/gpt-oss-20b", usage);

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.enoughEvidence === "boolean") {
      return { enoughEvidence: parsed.enoughEvidence };
    }
  } catch {
    // fall through
  }

  return { enoughEvidence: false };
}
