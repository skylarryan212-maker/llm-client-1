import { ENABLE_OCR } from "../config";
import type { Extractor } from "../types";
import { sha256 } from "../utils/buffer";
import { truncateUtf8 } from "../utils/text";

const ocrCache = new Map<string, string>();

export const imageOcrExtractor: Extractor = async (buffer, name, _mime, ctx) => {
  if (!ENABLE_OCR) {
    return {
      preview: "OCR disabled. Set ENABLE_OCR=true to enable.",
      meta: { kind: "image", size: ctx.size, status: "unsupported" },
    };
  }

  const cacheKey = sha256(buffer);
  if (ocrCache.has(cacheKey)) {
    const cached = ocrCache.get(cacheKey)!;
    return {
      preview: truncateUtf8(`(cached) ${cached}`),
      meta: { kind: "image", size: ctx.size, status: "ok", notes: ["OCR cache hit"] },
    };
  }

  try {
    const Tesseract = await import("tesseract.js");
    const result = await Tesseract.recognize(buffer, "eng");
    const text = (result?.data?.text || "").trim();
    const confidence = result?.data?.confidence;
    const preview = truncateUtf8(
      `Image OCR (${name || "image"})\nConfidence: ${
        confidence ?? "n/a"
      }\n${text}`,
    );
    ocrCache.set(cacheKey, preview);
    return {
      preview,
      meta: {
        kind: "image",
        size: ctx.size,
        status: text ? "ok" : "empty",
        stats: { confidence },
      },
    };
  } catch (err) {
    return {
      preview: "OCR failed",
      meta: { kind: "image", size: ctx.size, status: "parse_error", notes: [String(err)] },
    };
  }
};
