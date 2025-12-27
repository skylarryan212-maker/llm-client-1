import type OpenAI from "openai";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";
import { encodingForModel } from "js-tiktoken";
import { calculateEmbeddingCost } from "@/lib/pricing";

const EMBEDDING_MODEL = "text-embedding-3-small";
const FALLBACK_MAX_ITEMS_PER_BATCH = 100;
// Total token budget per embedding call (user text + items). Lower keeps latency/rate-limit risk down.
const MAX_BATCH_TOKENS = 30_000;
// Safety cap per item to stay under the model's per-input limit (~8k tokens).
const MAX_ITEM_TOKENS = 7_500;
let cachedEmbeddingEncoder: ReturnType<typeof encodingForModel> | null = null;

let cachedOpenAIClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (cachedOpenAIClient) return cachedOpenAIClient;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("[semantic] OPENAI_API_KEY not set; skipping semantic similarity.");
    return null;
  }
  cachedOpenAIClient = createOpenAIClient({ apiKey });
  return cachedOpenAIClient;
}

function getEmbeddingEncoder() {
  if (cachedEmbeddingEncoder) return cachedEmbeddingEncoder;
  try {
    cachedEmbeddingEncoder = encodingForModel(EMBEDDING_MODEL);
    return cachedEmbeddingEncoder;
  } catch (err) {
    console.warn("[semantic] Failed to load tokenizer for embeddings:", err);
    return null;
  }
}

function normalizeText(value?: string | null, maxLength?: number): string {
  if (!value) return "";
  const squashed = value.replace(/\s+/g, " ").trim();
  if (typeof maxLength === "number" && Number.isFinite(maxLength)) {
    return squashed.length <= maxLength ? squashed : squashed.slice(0, maxLength);
  }
  return squashed;
}

function buildTopicText(topic: TopicSemanticInput): string {
  const pieces = [
    normalizeText(topic.summary),
    normalizeText(topic.description),
  ].filter((part) => part.length > 0);
  return pieces.join(" | ");
}

function trimToTokenLimit(text: string, encoder: ReturnType<typeof encodingForModel> | null, maxTokens: number) {
  if (!encoder) return { text, tokens: 0, truncated: false };
  const tokens = encoder.encode(text);
  if (tokens.length <= maxTokens) {
    return { text, tokens: tokens.length, truncated: false };
  }
  const trimmed = encoder.decode(tokens.slice(0, maxTokens));
  return { text: trimmed, tokens: maxTokens, truncated: true };
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
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export type TopicSemanticInput = {
  id: string;
  label: string;
  summary: string | null;
  description: string | null;
  kind?: "topic" | "artifact";
  relatedTopicId?: string | null;
};

export type TopicSemanticMatch = {
  topicId: string;
  label: string;
  summary: string | null;
  description: string | null;
  similarity: number;
  kind: "topic" | "artifact";
  relatedTopicId?: string | null;
};

export async function computeTopicSemantics(
  userMessage: string,
  topics: TopicSemanticInput[],
  artifacts: Array<{
    id: string;
    title: string | null;
    summary: string | null;
    snippet?: string | null;
    topic_id?: string | null;
  }> = []
): Promise<TopicSemanticMatch[] | null> {
  if (!userMessage || !userMessage.trim() || !Array.isArray(topics) || topics.length === 0) {
    return null;
  }

  const client = getOpenAIClient();
  if (!client) return null;

  const encoder = getEmbeddingEncoder();

  const topicPayloads: Array<
    TopicSemanticInput & {
      text: string;
      kind: "topic" | "artifact";
      tokens?: number;
      truncated?: boolean;
    }
  > = [
    ...topics.map((topic) => ({
      ...topic,
      kind: "topic" as const,
      text: buildTopicText(topic),
    })),
    ...artifacts.map((artifact) => ({
      id: artifact.id,
      label: artifact.title ?? "(untitled artifact)",
      summary: artifact.summary,
      description: artifact.snippet ?? artifact.summary ?? null,
      kind: "artifact" as const,
      relatedTopicId: artifact.topic_id ?? null,
      text: buildTopicText({
        id: artifact.id,
        label: artifact.title ?? "",
        summary: artifact.summary,
        description: artifact.snippet ?? artifact.summary ?? null,
      }),
    })),
  ].filter((candidate) => candidate.text.length > 0);

  if (!topicPayloads.length) return null;

  if (encoder) {
    try {
      const tokenStats = topicPayloads.map((item) => {
        const { text, tokens, truncated } = trimToTokenLimit(item.text, encoder, MAX_ITEM_TOKENS);
        item.text = text;
        item.tokens = tokens;
        item.truncated = truncated;
        return {
          id: item.id,
          kind: item.kind,
          tokens,
          truncated,
        };
      });
      const topicTokens = tokenStats
        .filter((t) => t.kind === "topic")
        .reduce((sum, t) => sum + t.tokens, 0);
      const artifactTokens = tokenStats
        .filter((t) => t.kind === "artifact")
        .reduce((sum, t) => sum + t.tokens, 0);
      console.log(
        "[semantic] token stats",
        JSON.stringify(
          {
            topics: {
              count: tokenStats.filter((t) => t.kind === "topic").length,
              totalTokens: topicTokens,
              maxTokens: Math.max(0, ...tokenStats.filter((t) => t.kind === "topic").map((t) => t.tokens)),
            },
            artifacts: {
              count: tokenStats.filter((t) => t.kind === "artifact").length,
              totalTokens: artifactTokens,
              maxTokens: Math.max(0, ...tokenStats.filter((t) => t.kind === "artifact").map((t) => t.tokens)),
            },
          },
          null,
          2
        )
      );
      tokenStats.forEach((stat, idx) => {
        topicPayloads[idx].tokens = stat.tokens;
      });
    } catch (err) {
      console.warn("[semantic] Failed to compute token stats:", err);
    }
  }

  const allMatches: TopicSemanticMatch[] = [];
  let totalEmbeddingTokens = 0;

  // Build batches based on token budget (with a fallback item count cap).
  const batches: typeof topicPayloads[] = [];
  const userText = normalizeText(userMessage, 1600);
  const userTokens = encoder ? encoder.encode(userText).length : 0;
  let currentBatch: typeof topicPayloads = [];
  let currentTokens = userTokens;
  for (const item of topicPayloads) {
    const itemTokens = item.tokens ?? 0;
    const wouldExceed =
      (itemTokens || 0) + currentTokens > MAX_BATCH_TOKENS ||
      currentBatch.length >= FALLBACK_MAX_ITEMS_PER_BATCH;
    if (currentBatch.length && wouldExceed) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokens = userTokens;
    }
    currentBatch.push(item);
    currentTokens += itemTokens;
  }
  if (currentBatch.length) {
    batches.push(currentBatch);
  }

  try {
    for (const chunk of batches) {
      const inputs = [userText, ...chunk.map((topic) => topic.text)];
      const batchTokens =
        userTokens +
        chunk.reduce((sum, topic) => {
          const t = topic.tokens ?? 0;
          return sum + t;
        }, 0);
      totalEmbeddingTokens += batchTokens;
      const { data: response, response: rawResponse } = await client.embeddings
        .create({
          model: EMBEDDING_MODEL,
          input: inputs,
        })
        .withResponse();
      const requestId = getOpenAIRequestId(response, rawResponse);
      if (requestId) {
        console.log("[semantic] OpenAI request id", { requestId });
      }

      const data = response.data || [];
      if (data.length !== inputs.length) {
        console.warn("[semantic] Unexpected embedding response count", data.length, inputs.length);
      }

      const userEmbedding = data[0]?.embedding ?? [];
      for (let i = 0; i < chunk.length; i++) {
        const embedding = data[i + 1]?.embedding ?? [];
        const similarity = cosineSimilarity(userEmbedding, embedding);
        allMatches.push({
          topicId: chunk[i].id,
          label: chunk[i].label,
          summary: chunk[i].summary,
          description: chunk[i].description,
          similarity,
          kind: chunk[i].kind ?? "topic",
          relatedTopicId: chunk[i].relatedTopicId,
        });
      }
    }

    if (totalEmbeddingTokens > 0) {
      const estimatedCost = calculateEmbeddingCost(totalEmbeddingTokens);
      console.log("[semantic] embedding usage", {
        model: EMBEDDING_MODEL,
        totalEmbeddingTokens,
        estimatedCost,
      });
    }

    return allMatches.sort((a, b) => b.similarity - a.similarity);
  } catch (error) {
    console.error("[semantic] Failed to compute topic embeddings:", error);
    return null;
  }
}
