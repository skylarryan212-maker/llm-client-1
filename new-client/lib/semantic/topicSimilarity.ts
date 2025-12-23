import type OpenAI from "openai";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";

const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_TOPIC_TEXT_LENGTH = 1200;

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

function normalizeText(value?: string | null, maxLength = MAX_TOPIC_TEXT_LENGTH): string {
  if (!value) return "";
  const squashed = value.replace(/\s+/g, " ").trim();
  return squashed.length <= maxLength ? squashed : squashed.slice(0, maxLength);
}

function buildTopicText(topic: TopicSemanticInput): string {
  const pieces = [
    normalizeText(topic.label, 256),
    normalizeText(topic.summary, 512),
    normalizeText(topic.description, 512),
  ].filter((part) => part.length > 0);
  return pieces.join(" | ").slice(0, MAX_TOPIC_TEXT_LENGTH);
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
};

export type TopicSemanticMatch = {
  topicId: string;
  label: string;
  summary: string | null;
  description: string | null;
  similarity: number;
};

export async function computeTopicSemantics(
  userMessage: string,
  topics: TopicSemanticInput[]
): Promise<TopicSemanticMatch[] | null> {
  if (!userMessage || !userMessage.trim() || !Array.isArray(topics) || topics.length === 0) {
    return null;
  }

  const client = getOpenAIClient();
  if (!client) return null;

  const topicPayloads = topics
    .map((topic) => ({
      ...topic,
      text: buildTopicText(topic),
    }))
    .filter((topic) => topic.text.length > 0)
    .slice(0, 15);

  if (!topicPayloads.length) return null;

  const inputs = [normalizeText(userMessage, 1600), ...topicPayloads.map((topic) => topic.text)];

  try {
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
    const matches: TopicSemanticMatch[] = [];
    for (let i = 0; i < topicPayloads.length; i++) {
      const embedding = data[i + 1]?.embedding ?? [];
      const similarity = cosineSimilarity(userEmbedding, embedding);
      matches.push({
        topicId: topicPayloads[i].id,
        label: topicPayloads[i].label,
        summary: topicPayloads[i].summary,
        description: topicPayloads[i].description,
        similarity,
      });
    }

    return matches.sort((a, b) => b.similarity - a.similarity);
  } catch (error) {
    console.error("[semantic] Failed to compute topic embeddings:", error);
    return null;
  }
}
