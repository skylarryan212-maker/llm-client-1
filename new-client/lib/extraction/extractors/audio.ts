import { ENABLE_TRANSCRIPTION } from "../config";
import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";

async function transcribe(buffer: Buffer, name: string, mime: string | null) {
  const { OpenAI } = await import("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  // Create a Blob from a Uint8Array view to satisfy TS and browser BlobPart types
  const blob = new Blob([new Uint8Array(buffer)], {
    type: mime || "application/octet-stream",
  });
  const file = new File([blob], name || "audio");
  const res = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
  });
  const text =
    typeof (res as { text?: unknown }).text === "string"
      ? (res as { text: string }).text
      : "";
  const langAny = (res as any)?.language;
  const language = typeof langAny === "string" ? (langAny as string) : undefined;
  return { text, language };
}

export const audioExtractor: Extractor = async (buffer, name, mime, ctx) => {
  if (!ENABLE_TRANSCRIPTION) {
    return {
      preview: "Transcription disabled. Set ENABLE_TRANSCRIPTION=true to enable.",
      meta: { kind: "audio", size: ctx.size, status: "unsupported" },
    };
  }

  try {
    const { text, language } = await transcribe(buffer, name, mime);
    const preview = truncateUtf8(
      `Audio transcription${language ? ` (${language})` : ""}:\n${text}`,
    );
    return {
      preview,
      meta: {
        kind: "audio",
        size: ctx.size,
        status: text ? "ok" : "empty",
        stats: { language },
      },
    };
  } catch (err) {
    return {
      preview: "Audio transcription failed",
      meta: { kind: "audio", size: ctx.size, status: "parse_error", notes: [String(err)] },
    };
  }
};
