import { ENABLE_TRANSCRIPTION, LARGE_FILE_THRESHOLD } from "../config";
import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";
import { logGpt4oTranscribeUsageFromBytes } from "@/lib/usage";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";

async function transcribeVideo(
  buffer: Buffer,
  name: string,
  mime: string | null,
) {
  const openai = createOpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
  const blob = new Blob([new Uint8Array(buffer)], {
    type: mime || "application/octet-stream",
  });
  const file = new File([blob], name || "video");
  const { data: res, response: rawResponse } = await openai.audio.transcriptions
    .create({
      file,
      model: "gpt-4o-transcribe",
    })
    .withResponse();
  const requestId = getOpenAIRequestId(res, rawResponse);
  if (requestId) {
    console.log("[extraction][video] OpenAI request id", { requestId });
  }
  const text =
    typeof (res as { text?: unknown }).text === "string"
      ? (res as { text: string }).text
      : "";
  return { text };
}

export const videoExtractor: Extractor = async (buffer, name, mime, ctx) => {
  if (!ENABLE_TRANSCRIPTION) {
    return {
      preview: "Transcription disabled. Set ENABLE_TRANSCRIPTION=true to enable.",
      meta: { kind: "video", size: ctx.size, status: "unsupported" },
    };
  }
  if (ctx.size > LARGE_FILE_THRESHOLD) {
    return {
      preview: `Video too large for inline transcription (${ctx.size} bytes)`,
      meta: { kind: "video", size: ctx.size, status: "too_large" },
    };
  }

  try {
    const { text } = await transcribeVideo(buffer, name, mime);
    if (ctx.userId) {
      await logGpt4oTranscribeUsageFromBytes({
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        fileSizeBytes: ctx.size,
        transcript: text,
        buffer,
        fileName: name,
        mimeType: mime || undefined,
      });
    }
    const preview = truncateUtf8(
      `Video transcription:\n${text}\nResolution/Duration: not probed`,
    );
    return {
      preview,
      meta: {
        kind: "video",
        size: ctx.size,
        status: text ? "ok" : "empty",
        notes: ["Audio extracted directly; metadata not probed"],
      },
    };
  } catch (err) {
    return {
      preview: "Video transcription failed",
      meta: { kind: "video", size: ctx.size, status: "parse_error", notes: [String(err)] },
    };
  }
};
