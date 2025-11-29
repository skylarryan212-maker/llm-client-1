import { LOG_MAX_LINES } from "../config";
import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";

const SEVERITY_REGEX = /\b(INFO|WARN|ERROR|DEBUG)\b/;
const TIMESTAMP_REGEX =
  /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/;

export const logExtractor: Extractor = async (buffer, _name, _mime, ctx) => {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/);
  const severityCounts: Record<string, number> = {
    INFO: 0,
    WARN: 0,
    ERROR: 0,
    DEBUG: 0,
  };
  const errorLines = new Map<string, number>();
  let timestamped = 0;

  lines.slice(0, LOG_MAX_LINES).forEach((line) => {
    const sev = line.match(SEVERITY_REGEX)?.[1];
    if (sev) severityCounts[sev] += 1;
    if (sev === "ERROR") {
      errorLines.set(line.trim(), (errorLines.get(line.trim()) || 0) + 1);
    }
    if (TIMESTAMP_REGEX.test(line)) timestamped += 1;
  });

  const topErrorLines = Array.from(errorLines.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([line, count]) => `${count}× ${line}`);

  const previewBody = [
    `Lines scanned: ${Math.min(lines.length, LOG_MAX_LINES)} of ${lines.length}`,
    `Timestamped lines: ${timestamped}`,
    `Severity counts: ${JSON.stringify(severityCounts)}`,
    `Top ERROR lines:`,
    ...topErrorLines,
  ].join("\n");

  const preview = truncateUtf8(previewBody);
  return {
    preview,
    meta: {
      kind: "log",
      size: ctx.size,
      status: preview ? "ok" : "empty",
      stats: { severityCounts, timestamped, errors: topErrorLines },
    },
  };
};
