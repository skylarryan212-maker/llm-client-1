import JSZip from "jszip";
import { ARCHIVE_MAX_ENTRIES } from "../config";
import type { Extractor } from "../types";
import { sanitizeEntryPath } from "../utils/buffer";

export const archiveZipExtractor: Extractor = async (buffer, name, _mime, ctx) => {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const files = Object.keys(zip.files)
      .slice(0, ARCHIVE_MAX_ENTRIES)
      .map((f) => sanitizeEntryPath(f));
    const preview = files.length
      ? `[Archive contents: ${files.length} shown]\n${files.join("\n")}`
      : "Empty archive";
    return {
      preview,
      meta: {
        kind: "zip",
        size: ctx.size,
        status: files.length ? "ok" : "empty",
        notes:
          Object.keys(zip.files).length > files.length
            ? [`Truncated to ${ARCHIVE_MAX_ENTRIES} entries`]
            : undefined,
      },
    };
  } catch (err) {
    return {
      preview: `Failed to read zip archive ${name || ""}`,
      meta: { kind: "zip", size: ctx.size, status: "parse_error", notes: [String(err)] },
    };
  }
};
