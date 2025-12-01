export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { calculateWhisperCost } from "@/lib/pricing";
import { supabaseServer } from "@/lib/supabase/server";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }
  return new OpenAI({ apiKey });
}

// Estimate audio duration from file size (very rough approximation)
// WebM/Opus averages around 16-20 KB/s, we'll use 18 KB/s as middle ground
function estimateAudioDuration(fileSizeBytes: number): number {
  const BYTES_PER_SECOND = 18000;
  return fileSizeBytes / BYTES_PER_SECOND;
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
        const estimatedDuration = estimateAudioDuration(fileSizeBytes);
        const cost = calculateWhisperCost(estimatedDuration);
        
        console.log(`[whisper] Transcribed ${fileSizeBytes} bytes (~${estimatedDuration.toFixed(1)}s), cost: $${cost.toFixed(6)}`);
        
        const { randomUUID } = require("crypto");
        const { error: usageError } = await supabase
          .from("user_api_usage")
          .insert({
            id: randomUUID(),
            user_id: user.id,
            conversation_id: null, // No specific conversation for transcription
            model: "whisper-1",
            input_tokens: 0,
            cached_tokens: 0,
            output_tokens: 0,
            estimated_cost: cost,
            created_at: new Date().toISOString(),
          });
        
        if (usageError) {
          console.error("[whisper] Failed to log usage:", usageError);
        } else {
          console.log(`[whisper] Successfully logged usage: $${cost.toFixed(6)}`);
        }
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
