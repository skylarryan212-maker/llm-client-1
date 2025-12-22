import { calculateCost, calculateGpt4oTranscribeCost } from "@/lib/pricing";
import { measureAudioDurationSeconds } from "@/lib/audio-duration";
import { supabaseServerAdmin } from "@/lib/supabase/server";
import { estimateTokens } from "@/lib/tokens/estimateTokens";

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

export async function logGpt4oTranscribeUsageFromBytes({
  userId,
  conversationId,
  fileSizeBytes,
  transcript,
  durationSeconds,
  buffer,
  fileName,
  mimeType,
}: {
  userId?: string | null;
  conversationId?: string | null;
  fileSizeBytes: number;
  transcript?: string;
  durationSeconds?: number;
  buffer?: Buffer;
  fileName?: string;
  mimeType?: string;
}) {
  if (!userId) return;
  const duration =
    typeof durationSeconds === "number"
      ? durationSeconds
      : buffer
        ? await measureAudioDurationSeconds(buffer, fileName, mimeType)
        : fileSizeBytes / 18_000;
  const textTokens = transcript ? estimateTokens(transcript) : 0;
  const cost = calculateGpt4oTranscribeCost(duration, textTokens);
  await logUsageRecord({
    userId,
    conversationId,
    model: "gpt-4o-transcribe",
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: textTokens,
    estimatedCost: cost,
  });
}
