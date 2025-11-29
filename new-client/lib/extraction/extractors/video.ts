import { ENABLE_TRANSCRIPTION, LARGE_FILE_THRESHOLD } from "../config";
import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";

async function transcribeVideo(
  buffer: Buffer,
  name: string,
  mime: string | null,
) {
  const { OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const blob = new Blob([new Uint8Array(buffer)], {
    type: mime || "application/octet-stream",
  });
  const file = new File([blob], name || "video");
  const res = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
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
