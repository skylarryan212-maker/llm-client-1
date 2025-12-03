import { ENABLE_OCR, OCR_MAX_MS, IMAGE_MAX_WIDTH } from "../config";
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
    // Downscale very large images to speed up OCR
    let ocrBuffer = buffer;
    const LARGE_IMAGE_BYTES = 1_500_000; // ~1.5MB
    if (ocrBuffer.length > LARGE_IMAGE_BYTES) {
      try {
        const sharpMod = await import("sharp");
        const sharp = sharpMod.default || (sharpMod as unknown as (input: Buffer) => any);
        // Resize to a reasonable width to speed up OCR while keeping legibility
        const resized = await (sharp as any)(ocrBuffer)
          .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
          .toFormat("png")
          .toBuffer();
        ocrBuffer = resized;
      } catch {
        // If sharp isn't available or fails, continue with original buffer
      }
    }

    // @ts-expect-error - tesseract.js is an optional dependency
    const Tesseract = await import("tesseract.js");

    // Enforce a max OCR duration so responses don't hang
    const MAX_OCR_MS = OCR_MAX_MS; // configurable via env
    const recognizePromise = Tesseract.recognize(ocrBuffer, "eng");
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("OCR timeout")), MAX_OCR_MS)
    );
    const result = await Promise.race([recognizePromise, timeoutPromise]) as any;

    if (!result || !result.data) {
      return {
        preview: "OCR timed out or returned no data",
        meta: { kind: "image", size: ctx.size, status: "parse_error", notes: ["timeout or empty"] },
      };
    }
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
