import { calculateCost, calculateWhisperCost } from "@/lib/pricing";
import { supabaseServerAdmin } from "@/lib/supabase/server";

export interface UsageLogParams {
  userId?: string | null;
  conversationId?: string | null;
  model: string;
  inputTokens: number;
  cachedTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
}

export async function logUsageRecord({
  userId,
  conversationId,
  model,
  inputTokens,
  cachedTokens = 0,
  outputTokens = 0,
  estimatedCost,
}: UsageLogParams) {
  if (!userId) return;

  try {
    const supabase = await supabaseServerAdmin();
    const cost =
      typeof estimatedCost === "number"
        ? estimatedCost
        : calculateCost(model, inputTokens, cachedTokens, outputTokens);
    const { randomUUID } = require("crypto");
    const payload = {
      id: randomUUID(),
      user_id: userId,
      conversation_id: conversationId ?? null,
      model,
      input_tokens: inputTokens,
      cached_tokens: cachedTokens,
      output_tokens: outputTokens,
      estimated_cost: cost,
      created_at: new Date().toISOString(),
    };
    const { error } = await (supabase as any)
      .from("user_api_usage")
      .insert(payload);
    if (error) {
      console.error("[usage] Failed to log usage:", error);
    }
  } catch (error) {
    console.error("[usage] Unexpected error logging usage:", error);
  }
}

const BYTES_PER_SECOND = 18_000;

export function estimateAudioDurationSeconds(fileSizeBytes: number) {
  return fileSizeBytes / BYTES_PER_SECOND;
}

export async function logWhisperUsageFromBytes({
  userId,
  conversationId,
  fileSizeBytes,
}: {
  userId?: string | null;
  conversationId?: string | null;
  fileSizeBytes: number;
}) {
  if (!userId) return;
  const duration = estimateAudioDurationSeconds(fileSizeBytes);
  const cost = calculateWhisperCost(duration);
  await logUsageRecord({
    userId,
    conversationId,
    model: "whisper-1",
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    estimatedCost: cost,
  });
}
