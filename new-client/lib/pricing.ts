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

// Tool call pricing (per 1k calls)
export const TOOL_CALL_PRICING_PER_1K = {
  web_search: 2.5, // $2.50 / 1k tool calls (tool version/model dependent; using default)
  file_search: 2.5, // Responses API file_search tool calls
} as const;

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
