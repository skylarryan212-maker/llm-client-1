import * as tar from "tar-stream";
import type { Headers } from "tar-stream";
import pako from "pako";
import { ARCHIVE_MAX_ENTRIES } from "../config";
import type { Extractor } from "../types";
import { isLikelyText, sanitizeEntryPath } from "../utils/buffer";
import { truncateUtf8 } from "../utils/text";

export const archiveTarGzipExtractor: Extractor = async (
  buffer,
  name,
  mime,
  ctx,
) => {
  const lowerMime = (mime || "").toLowerCase();
  const isGzip = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  let working = buffer;
  const notes: string[] = [];

  if (isGzip || lowerMime.includes("gzip")) {
    try {
      const inflated = pako.inflate(new Uint8Array(buffer));
      working = Buffer.from(inflated);
      notes.push("Gzip decompressed");
    } catch (err) {
      return {
        preview: "Failed to decompress gzip",
        meta: { kind: "gzip", size: ctx.size, status: "parse_error", notes: [String(err)] },
      };
    }
  }

  const looksTar =
    working.length > 265 &&
    working.subarray(257, 262).toString("utf-8") === "ustar";
  if (looksTar || lowerMime.includes("tar") || name.toLowerCase().endsWith(".tar")) {
    const entries: string[] = [];
    const extract = tar.extract();
    const listing = new Promise<void>((resolve, reject) => {
      extract.on("entry", (header: Headers, stream: NodeJS.ReadableStream, next: () => void) => {
        if (entries.length < ARCHIVE_MAX_ENTRIES) {
          entries.push(sanitizeEntryPath(header.name));
        }
        stream.resume();
        next();
      });
      extract.on("finish", resolve);
      extract.on("error", reject);
    });
    extract.end(working);
    try {
      await listing;
    } catch (err) {
      return {
        preview: "Failed to read tar archive",
        meta: { kind: "tar", size: ctx.size, status: "parse_error", notes: [String(err)] },
      };
    }
    const preview = entries.length
      ? `[Archive contents: ${entries.length} shown]\n${entries.join("\n")}`
      : "Empty tar archive";
    return {
      preview,
      meta: {
        kind: isGzip ? "gzip" : "tar",
        size: ctx.size,
        status: entries.length ? "ok" : "empty",
        notes,
      },
    };
  }

  if (isLikelyText(working)) {
    const preview = truncateUtf8(working.toString("utf-8"));
    return {
      preview,
      meta: { kind: isGzip ? "gzip" : "tar", size: ctx.size, status: preview ? "ok" : "empty", notes },
    };
  }

  return {
    preview: "Decompressed data is not tar or text",
    meta: { kind: isGzip ? "gzip" : "tar", size: ctx.size, status: "unsupported", notes },
  };
};
