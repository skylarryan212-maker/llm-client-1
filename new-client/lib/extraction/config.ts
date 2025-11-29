export const ENABLE_OCR = process.env.ENABLE_OCR === "true";
export const ENABLE_TRANSCRIPTION = process.env.ENABLE_TRANSCRIPTION === "true";
export const ENABLE_LEGACY_CONVERT =
  process.env.ENABLE_LEGACY_CONVERT === "true";
export const MAX_PREVIEW_BYTES = parseInt(
  process.env.MAX_PREVIEW_BYTES || "32768",
  10,
);
export const LARGE_FILE_THRESHOLD = parseInt(
  process.env.LARGE_FILE_THRESHOLD || "150000",
  10,
);
export const PDF_MAX_PAGES = parseInt(
  process.env.PDF_MAX_PAGES || "40",
  10,
);
export const ARCHIVE_MAX_ENTRIES = parseInt(
  process.env.ARCHIVE_MAX_ENTRIES || "100",
  10,
);
export const NDJSON_MAX_LINES = parseInt(
  process.env.NDJSON_MAX_LINES || "5000",
  10,
);
export const LOG_MAX_LINES = parseInt(
  process.env.LOG_MAX_LINES || "5000",
  10,
);
