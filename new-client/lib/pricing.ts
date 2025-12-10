// OpenAI pricing per 1M tokens as of December 2025
export const MODEL_PRICING = {
  "text-embedding-3-small": {
    input: 0.02,
    cached: 0,
    output: 0,
  },
  "gpt-5.1-2025-11-13": {
    input: 1.25,
    cached: 0.125,
    output: 10.0,
  },
  "gpt-5-mini-2025-08-07": {
    input: 0.25,
    cached: 0.025,
    output: 2.0,
  },
  "gpt-5-nano-2025-08-07": {
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
  "gpt-5-pro-2025-10-06": {
    input: 15.0,
    cached: 1.5,
    output: 120.0,
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
