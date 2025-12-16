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
} as const;

// Vector store pricing (per GB per day)
export const VECTOR_STORE_STORAGE_COST_PER_GB_DAY = 0.10;

// Audio transcription pricing (per minute)
export const WHISPER_COST_PER_MINUTE = 0.006;

// File operations pricing
export const FILE_OPERATIONS_PRICING = {
  // Vector store file upload is free, only storage costs apply
  vector_store_search: 0.0, // Included in model costs
};

export function calculateCost(
  model: string,
  inputTokens: number,
  cachedTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING];
  if (!pricing) {
    console.warn(`Unknown model for pricing: ${model}`);
    return 0;
  }

  const inputCost = ((inputTokens - cachedTokens) / 1_000_000) * pricing.input;
  const cachedCost = (cachedTokens / 1_000_000) * pricing.cached;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + cachedCost + outputCost;
}

export function calculateVectorStorageCost(sizeInBytes: number, durationInDays: number): number {
  const sizeInGB = sizeInBytes / (1024 * 1024 * 1024);
  return sizeInGB * durationInDays * VECTOR_STORE_STORAGE_COST_PER_GB_DAY;
}

export function calculateWhisperCost(durationInSeconds: number): number {
  const durationInMinutes = durationInSeconds / 60;
  return durationInMinutes * WHISPER_COST_PER_MINUTE;
}
