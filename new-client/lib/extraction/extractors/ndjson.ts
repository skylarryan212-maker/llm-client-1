import { NDJSON_MAX_LINES } from "../config";
import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";

export const ndjsonExtractor: Extractor = async (buffer, _name, _mime, ctx) => {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/);
  let parsedCount = 0;
  const keyFreq = new Map<string, number>();
  const samples: string[] = [];

  for (let i = 0; i < lines.length && i < NDJSON_MAX_LINES; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      parsedCount += 1;
      if (samples.length < 10) {
        samples.push(JSON.stringify(obj));
      }
      Object.keys(obj || {}).forEach((k) => {
        keyFreq.set(k, (keyFreq.get(k) || 0) + 1);
      });
    } catch {
      // ignore malformed lines
    }
  }

  const topKeys = Array.from(keyFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([k, v]) => `${k}: ${v}`);

  const previewBody = [
    `Lines (scanned/total): ${Math.min(lines.length, NDJSON_MAX_LINES)}/${lines.length}`,
    `Parsed objects: ${parsedCount}`,
    `Top keys:`,
    topKeys.join(", "),
    `Samples:`,
    samples.join("\n"),
  ]
    .filter(Boolean)
    .join("\n");

  const preview = truncateUtf8(previewBody);
  return {
    preview,
    meta: {
      kind: "ndjson",
      size: ctx.size,
      status: preview ? "ok" : "empty",
      stats: { parsed: parsedCount, totalLines: lines.length, topKeys },
    },
  };
};
