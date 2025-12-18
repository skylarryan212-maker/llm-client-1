export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { calculateWhisperCost } from "@/lib/pricing";
import { supabaseServer } from "@/lib/supabase/server";
import { logUsageRecord, estimateAudioDurationSeconds } from "@/lib/usage";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }
  return new OpenAI({ apiKey });
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
    const transcription: any = await (client.audio.transcriptions.create as any)({
      file: audioFile,
      model: "whisper-1",
      temperature: 0,
      response_format: "verbose_json",
    });

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
        const estimatedDuration = estimateAudioDurationSeconds(fileSizeBytes);
        const cost = calculateWhisperCost(estimatedDuration);
        
        console.log(`[whisper] Transcribed ${fileSizeBytes} bytes (~${estimatedDuration.toFixed(1)}s), cost: $${cost.toFixed(6)}`);
        
        await logUsageRecord({
          userId: user.id,
          conversationId: null,
          model: "whisper-1",
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          estimatedCost: cost,
        });
      }
    } catch (trackingErr) {
      console.error("[whisper] Cost tracking error:", trackingErr);
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
