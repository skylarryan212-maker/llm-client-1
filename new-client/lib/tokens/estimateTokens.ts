import { encodingForModel } from "js-tiktoken";

let cachedEncoder: ReturnType<typeof encodingForModel> | null = null;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  try {
    if (!cachedEncoder) {
      // gpt-4o-mini is the closest available tokenizer approximation for our GPT-5 models
      cachedEncoder = encodingForModel("gpt-4o-mini");
    }
    return cachedEncoder.encode(text).length;
  } catch (err) {
    console.warn("[tokens] Falling back to length-based estimate:", err);
    // Fallback heuristic if tokenizer fails
    return Math.ceil(text.length / 4) + 4;
  }
}
