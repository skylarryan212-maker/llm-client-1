import { LARGE_FILE_THRESHOLD } from "./config";
import { detectKind } from "./detect";
import type { Extractor, ExtractionResult } from "./types";
import { formatPreview } from "./utils/text";
import { fallbackExtractor } from "./extractors/fallback";
import { pdfExtractor } from "./extractors/pdf";
import { odfExtractor } from "./extractors/odf";
import { epubExtractor } from "./extractors/epub";
import { tsvPsvExtractor } from "./extractors/tsvPsv";
import { archiveZipExtractor } from "./extractors/archiveZip";
import { archiveTarGzipExtractor } from "./extractors/archiveTarGzip";
import { ndjsonExtractor } from "./extractors/ndjson";
import { logExtractor } from "./extractors/log";
import { structuredExtractor } from "./extractors/structured";
import { rtfExtractor } from "./extractors/rtf";
import { codeExtractor } from "./extractors/code";
import { imageOcrExtractor } from "./extractors/imageOcr";
import { audioExtractor } from "./extractors/audio";
import { videoExtractor } from "./extractors/video";
import { legacyOfficeExtractor } from "./extractors/legacyOffice";

const EXTRACTOR_MAP: Record<string, Extractor> = {
  pdf: pdfExtractor,
  zip: archiveZipExtractor,
  odf: odfExtractor,
  epub: epubExtractor,
  tsv: tsvPsvExtractor,
  psv: tsvPsvExtractor,
  tar: archiveTarGzipExtractor,
  gzip: archiveTarGzipExtractor,
  ndjson: ndjsonExtractor,
  log: logExtractor,
  structured: structuredExtractor,
  rtf: rtfExtractor,
  code: codeExtractor,
  image: imageOcrExtractor,
  audio: audioExtractor,
  video: videoExtractor,
  legacy_office: legacyOfficeExtractor,
  text: codeExtractor, // code extractor handles generic text summarization too
};

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
  const extractor: Extractor = EXTRACTOR_MAP[detectedKind] || fallbackExtractor;

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
