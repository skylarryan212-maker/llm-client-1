import { MAX_PREVIEW_BYTES } from "../config";
import type { ExtractionMeta } from "../types";

const STATUS_CODE_MAP: Record<ExtractionMeta["status"], string> = {
  ok: "OK",
  too_large: "TOO_LARGE",
  unsupported: "UNSUPPORTED",
  parse_error: "PARSE_ERROR",
  encrypted: "ENCRYPTED",
  empty: "EMPTY",
};

export function truncateUtf8(text: string, limit = MAX_PREVIEW_BYTES): string {
  const buf = Buffer.from(text, "utf-8");
  if (buf.byteLength <= limit) return text;
  return buf.subarray(0, limit).toString("utf-8");
}

export function formatPreview(
  status: ExtractionMeta["status"],
  body: string,
): string {
  const code = STATUS_CODE_MAP[status] || "UNKNOWN";
  const header = `[status: ${code}]`;
  const cleanBody = body?.trim() ? truncateUtf8(body) : "";
  return cleanBody ? `${header}\n${cleanBody}` : header;
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function lines(text: string): string[] {
  return normalizeNewlines(text).split("\n");
}

export function takeLines(text: string, maxLines: number): string {
  const parts = lines(text);
  if (parts.length <= maxLines) return text;
  return parts.slice(0, maxLines).join("\n");
}
