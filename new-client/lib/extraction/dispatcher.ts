import { LARGE_FILE_THRESHOLD } from "./config";
import { detectKind } from "./detect";
import type { Extractor, ExtractionResult } from "./types";
import { formatPreview } from "./utils/text";
import { fallbackExtractor } from "./extractors/fallback";
import { logExtractor } from "./extractors/log";
import { structuredExtractor } from "./extractors/structured";
import { codeExtractor } from "./extractors/code";
import { tsvPsvExtractor } from "./extractors/tsvPsv";
import { ndjsonExtractor } from "./extractors/ndjson";

async function loadExtractor(kind: string): Promise<Extractor> {
  switch (kind) {
    case "pdf": {
      const mod = await import("./extractors/pdf");
      return mod.pdfExtractor;
    }
    case "zip": {
      const mod = await import("./extractors/archiveZip");
      return mod.archiveZipExtractor;
    }
    case "odf": {
      const mod = await import("./extractors/odf");
      return mod.odfExtractor;
    }
    case "epub": {
      const mod = await import("./extractors/epub");
      return mod.epubExtractor;
    }
    case "tar":
    case "gzip": {
      const mod = await import("./extractors/archiveTarGzip");
      return mod.archiveTarGzipExtractor;
    }
    case "ndjson": {
      return ndjsonExtractor;
    }
    case "log": {
      return logExtractor;
    }
    case "structured": {
      return structuredExtractor;
    }
    case "rtf": {
      const mod = await import("./extractors/rtf");
      return mod.rtfExtractor;
    }
    case "image": {
      const mod = await import("./extractors/imageOcr");
      return mod.imageOcrExtractor;
    }
    case "audio": {
      const mod = await import("./extractors/audio");
      return mod.audioExtractor;
    }
    case "video": {
      const mod = await import("./extractors/video");
      return mod.videoExtractor;
    }
    case "legacy_office": {
      const mod = await import("./extractors/legacyOffice");
      return mod.legacyOfficeExtractor;
    }
    case "tsv":
    case "psv": {
      return tsvPsvExtractor;
    }
    case "code":
    case "text": {
      return codeExtractor; // code extractor handles generic text summarization too
    }
    default:
      return fallbackExtractor;
  }
}

const HEAVY_KINDS = new Set([
  "pdf",
  "zip",
  "odf",
  "epub",
  "tar",
  "gzip",
  "audio",
  "video",
  "image",
]);

export async function dispatchExtract(
  buffer: Buffer,
  name: string,
  mime: string | null,
): Promise<ExtractionResult> {
  const size = buffer.length;
  if (!size) {
    const preview = formatPreview("empty", "Empty file");
    return {
      preview,
      meta: { kind: "empty", size, status: "empty" },
    };
  }

  const detectedKind = detectKind(buffer, name, mime);
  const extractor: Extractor = await loadExtractor(detectedKind);

  if (size > LARGE_FILE_THRESHOLD && HEAVY_KINDS.has(detectedKind)) {
    const preview = formatPreview(
      "too_large",
      `File too large (${size} bytes) for inline extraction. Use file_search for full content.`,
    );
    return {
      preview,
      meta: {
        kind: detectedKind,
        size,
        status: "too_large",
        notes: ["Large file gating applied", `Limit: ${LARGE_FILE_THRESHOLD}`],
      },
    };
  }

  try {
    const result = await extractor(buffer, name, mime, { size });
    const meta = {
      ...result.meta,
      kind: detectedKind,
      size,
    };
    const preview = formatPreview(
      meta.status || "empty",
      result.preview || "",
    );
    return { preview, meta };
  } catch (err) {
    console.error("[dispatcher] extraction failed", {
      name,
      mime,
      detectedKind,
      error: err,
    });
    const preview = formatPreview(
      "parse_error",
      "Extraction failed due to unexpected error",
    );
    return {
      preview,
      meta: {
        kind: detectedKind,
        size,
        status: "parse_error",
        notes: [String(err)],
      },
    };
  }
}
