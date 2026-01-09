// OpenAI pricing per 1M tokens as of December 2025
export const MODEL_PRICING = {
  "gpt-5.2": {
    input: 1.75,
    cached: 0.175,
    output: 14.0,
  },
  "gpt-5.2-pro": {
    input: 21.0,
    cached: 2.1,
    output: 168.0,
  },
  "gpt-5-mini": {
    input: 0.25,
    cached: 0.025,
    output: 2.0,
  },
  "gpt-5-nano": {
    input: 0.05,
    cached: 0.005,
    output: 0.4,
  },
  "grok-4-1-fast-non-reasoning-latest": {
    input: 0.20,
    cached: 0.05,
    output: 0.50,
  },
  "grok-4-1-fast-reasoning-latest": {
    input: 0.20,
    cached: 0.05,
    output: 0.50,
  },
  // Cloudflare Workers AI @cf/meta/llama-3.2-1b-instruct (per 1M tokens, placeholder low-cost assumption)
  "@cf/meta/llama-3.2-1b-instruct": {
    input: 0.027,
    cached: 0,
    output: 0.20,
  },
  // DeepInfra Meta-Llama 3.1 8B Instruct Turbo (user-provided rates: $0.02 input / $0.03 output per 1M)
  "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo": {
    input: 0.02,
    cached: 0.002, // assume ~10% discount for cached tokens (align with other models)
    output: 0.03,
  },
  // DeepInfra gpt-oss-20b (per-model page: $0.03 input / $0.14 output per 1M)
  "gpt-oss-20b": {
    input: 0.03,
    cached: 0, // no cached token pricing provided
    output: 0.14,
  },
  // DeepInfra OpenAI-compatible gpt-oss-20b
  "openai/gpt-oss-20b": {
    input: 0.03,
    cached: 0,
    output: 0.14,
  },
  // DeepInfra Gemma 3 4B IT
  "google/gemma-3-4b-it": {
    input: 0.04, // $0.04 per 1M input tokens
    cached: 0,
    output: 0.08, // $0.08 per 1M output tokens
  },
  "mistralai/Mistral-Small-24B-Instruct-2501": {
    input: 0.05,
    cached: 0, // no cached token pricing provided
    output: 0.08,
  },
  "gpt-4o-mini": {
    input: 0.6,
    cached: 0.06,
    output: 2.4,
  },
  "gpt-4o-transcribe": {
    input: 2.5,
    cached: 0,
    output: 10,
  },
} as const;

// Vector store pricing (per GB per day)
export const VECTOR_STORE_STORAGE_COST_PER_GB_DAY = 0.10;

// Audio transcription pricing (per minute)
// File operations pricing
export const FILE_OPERATIONS_PRICING = {
  // Vector store file upload is free, only storage costs apply
  vector_store_search: 0.0, // Included in model costs
};

// Tool call pricing (per 1k calls)
export const TOOL_CALL_PRICING_PER_1K = {
  web_search: 10.0, // $10.00 / 1k tool calls (OpenAI web_search)
  file_search: 2.5, // Responses API file_search tool calls
} as const;

const GROK_FAST_STANDARD_CONTEXT_LIMIT = 128_000;
const GROK_FAST_STANDARD_PRICING = {
  input: 0.20,
  cached: 0.05,
  output: 0.50,
};
const GROK_FAST_LONG_CONTEXT_PRICING = {
  input: 0.40,
  cached: 0.05,
  output: 1.00,
};

// Gemini native image generation pricing (AI Studio) as of Dec 2025.
// Note: image output is billed per-image (token-equivalent internally); we estimate per image.
export const GEMINI_IMAGE_PRICING = {
  "gemini-2.5-flash-image": {
    inputPer1M: 0.30, // USD per 1M input tokens (text/image)
    outputPerImage: 0.039, // USD per image
  },
  // Assumes 1024-2048px output (~1120 tokens equivalent) => ~$0.134/image.
  "gemini-3-pro-image-preview": {
    inputPer1M: 2.0, // USD per 1M input tokens (text/image)
    outputPerImage: 0.134, // USD per image (1K/2K estimate)
  },
} as const;

// Code Interpreter pricing (per session/container lifecycle)
export const CODE_INTERPRETER_SESSION_COST = 0.03;

const GPT4O_TRANSCRIBE_AUDIO_COST_PER_TOKEN = 6 / 1_000_000;
// Docs (Realtime cost guide) describe user input audio tokens as ~1 token / 100ms => ~10 tokens/sec.
// The /v1/audio/transcriptions endpoint does not currently return audio token usage, so we estimate.
const GPT4O_TRANSCRIBE_AUDIO_TOKENS_PER_SECOND = 10;
const GPT4O_TRANSCRIBE_TEXT_OUTPUT_COST_PER_TOKEN = 10 / 1_000_000;

export function calculateCost(
  model: string,
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number
): number {
  const pricing =
    (model === "grok-4-1-fast-non-reasoning-latest" ||
      model === "grok-4-1-fast-reasoning-latest") &&
    inputTokens > GROK_FAST_STANDARD_CONTEXT_LIMIT
      ? GROK_FAST_LONG_CONTEXT_PRICING
      : MODEL_PRICING[model as keyof typeof MODEL_PRICING];
  if (!pricing) {
    console.warn(`Unknown model for pricing: ${model}`);
    return 0;
  }

  const inputCost = ((inputTokens - cachedTokens) / 1_000_000) * pricing.input;
  const cachedCost = (cachedTokens / 1_000_000) * pricing.cached;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + cachedCost + outputCost;
}

export function calculateGrokFastDeterministicCost(
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number
): number {
  const inputBelow = Math.min(inputTokens, GROK_FAST_STANDARD_CONTEXT_LIMIT);
  const inputAbove = Math.max(0, inputTokens - GROK_FAST_STANDARD_CONTEXT_LIMIT);
  const inputCost =
    (inputBelow / 1_000_000) * GROK_FAST_STANDARD_PRICING.input +
    (inputAbove / 1_000_000) * GROK_FAST_LONG_CONTEXT_PRICING.input;
  const cachedCost = (cachedTokens / 1_000_000) * GROK_FAST_STANDARD_PRICING.cached;
  const outputCost = (outputTokens / 1_000_000) * GROK_FAST_STANDARD_PRICING.output;
  return inputCost + cachedCost + outputCost;
}

export function calculateVectorStorageCost(sizeInBytes: number, durationInDays: number): number {
  const sizeInGB = sizeInBytes / (1024 * 1024 * 1024);
  return sizeInGB * durationInDays * VECTOR_STORE_STORAGE_COST_PER_GB_DAY;
}

export function calculateGpt4oTranscribeCost(durationInSeconds: number, outputTokens: number): number {
  const audioTokens = durationInSeconds * GPT4O_TRANSCRIBE_AUDIO_TOKENS_PER_SECOND;
  const audioCost = audioTokens * GPT4O_TRANSCRIBE_AUDIO_COST_PER_TOKEN;
  const textCost = Math.max(0, outputTokens) * GPT4O_TRANSCRIBE_TEXT_OUTPUT_COST_PER_TOKEN;
  return audioCost + textCost;
}

export function calculateToolCallCost(type: keyof typeof TOOL_CALL_PRICING_PER_1K, callCount: number): number {
  const ratePer1k = TOOL_CALL_PRICING_PER_1K[type];
  if (!ratePer1k || callCount <= 0) return 0;
  return (callCount / 1000) * ratePer1k;
}

export function calculateGeminiImageCost(model: string, inputTokens: number, imageCount: number): number {
  const pricing = GEMINI_IMAGE_PRICING[model as keyof typeof GEMINI_IMAGE_PRICING];
  if (!pricing) {
    console.warn(`Unknown Gemini image model for pricing: ${model}`);
    return 0;
  }
  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPer1M;
  const outputCost = Math.max(0, imageCount) * pricing.outputPerImage;
  return inputCost + outputCost;
}

// Embedding pricing (OpenAI text-embedding-3-small as of December 2025).
// $0.02 / 1M tokens for batch embedding calls.
export const EMBEDDING_COST_PER_1M_TOKENS = 0.02;

export function calculateEmbeddingCost(tokens: number): number {
  if (!tokens || tokens <= 0) return 0;
  return (tokens / 1_000_000) * EMBEDDING_COST_PER_1M_TOKENS;
}
