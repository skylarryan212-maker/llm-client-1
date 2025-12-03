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
    const transcription = await client.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-1",
    });

    const transcript = (transcription.text || "").trim();

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

    return NextResponse.json({ transcript });
  } catch (error) {
    console.error("Transcription error", error);
    return NextResponse.json(
      { error: "Unable to transcribe audio" },
      { status: 500 }
    );
  }
}
