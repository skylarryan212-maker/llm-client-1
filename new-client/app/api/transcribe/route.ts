export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";
import { supabaseServer } from "@/lib/supabase/server";
import { logUsageRecord } from "@/lib/usage";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { measureAudioDurationSeconds } from "@/lib/audio-duration";
import { calculateGpt4oTranscribeCost } from "@/lib/pricing";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }
  return createOpenAIClient({ apiKey });
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioBlob = formData.get("audio");
    if (!(audioBlob instanceof Blob)) {
      return NextResponse.json(
        { error: "Audio file is required" },
        { status: 400 }
      );
    }

    const arrayBuffer = await audioBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = (audioBlob as File).name || "voice-message.webm";
    const mimeType = audioBlob.type || "audio/webm";
    const audioFile = new File([new Uint8Array(buffer)], fileName, { type: mimeType });

    const client = getOpenAIClient();
    const { data: transcription, response: rawResponse } = await (
      client.audio.transcriptions.create as any
    )({
      file: audioFile,
      model: "gpt-4o-transcribe",
      temperature: 0,
      response_format: "json",
    }).withResponse();
    const requestId = getOpenAIRequestId(transcription, rawResponse);
    if (requestId) {
      console.log("[gpt-4o-transcribe] OpenAI request id", { requestId });
    }

    const transcript = (typeof transcription?.text === "string" ? transcription.text : "").trim();
    const segments = Array.isArray(transcription?.segments) ? transcription.segments : [];
    const noSpeechProbs = segments
      .map((segment: any) => segment?.no_speech_prob)
      .filter((value: unknown): value is number => typeof value === "number" && Number.isFinite(value));

    const avgNoSpeech = average(noSpeechProbs);
    const maxNoSpeech = noSpeechProbs.length ? Math.max(...noSpeechProbs) : 0;

    const isLikelyNoSpeech =
      noSpeechProbs.length > 0 && avgNoSpeech >= 0.82 && maxNoSpeech >= 0.9;

    const sanitizedTranscript = isLikelyNoSpeech ? "" : transcript;

    // Track Whisper usage costs
    try {
      const supabase = await supabaseServer();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        const fileSizeBytes = buffer.length;
        const durationSeconds = await measureAudioDurationSeconds(buffer, fileName, mimeType);
        const transcriptTokens = estimateTokens(transcript);
        const cost = calculateGpt4oTranscribeCost(durationSeconds, transcriptTokens);

        console.log(
          `[gpt-4o-transcribe] Transcribed ${fileSizeBytes} bytes (~${durationSeconds.toFixed(
            1
          )}s), cost: $${cost.toFixed(6)}`
        );

        await logUsageRecord({
          userId: user.id,
          conversationId: null,
          model: "gpt-4o-transcribe",
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: transcriptTokens,
          estimatedCost: cost,
        });
      }
    } catch (trackingErr) {
      console.error("[gpt-4o-transcribe] Cost tracking error:", trackingErr);
    }

    return NextResponse.json({ transcript: sanitizedTranscript, ...(isLikelyNoSpeech ? { noSpeech: true } : {}) });
  } catch (error) {
    console.error("Transcription error", error);
    return NextResponse.json(
      { error: "Unable to transcribe audio" },
      { status: 500 }
    );
  }
}
