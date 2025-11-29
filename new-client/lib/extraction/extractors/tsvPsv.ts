import { truncateUtf8 } from "../utils/text";
import type { Extractor } from "../types";

const MAX_ROWS = 200;

export const tsvPsvExtractor: Extractor = async (buffer, name, mime, ctx) => {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const firstLine = lines.find((l) => l.trim().length > 0) ?? "";
  const delimiter = chooseDelimiter(firstLine, mime || "", name || "");
  const sampled = lines.slice(0, MAX_ROWS).map((line) => line.split(delimiter).join("\t"));
  const preview = truncateUtf8(sampled.join("\n"));
  const columnCount = firstLine ? firstLine.split(delimiter).length : 0;
  return {
    preview,
    meta: {
      kind: "tsv",
      size: ctx.size,
      status: preview ? "ok" : "empty",
      stats: { delimiter, rows: lines.length, columns: columnCount },
    },
  };
};

function chooseDelimiter(firstLine: string, mime: string, name: string): string {
  const lowerMime = mime.toLowerCase();
  if (lowerMime.includes("tsv") || name.toLowerCase().endsWith(".tsv")) return "\t";
  if (lowerMime.includes("psv") || name.toLowerCase().endsWith(".psv")) return "|";
  const counts = {
    ",": (firstLine.match(/,/g) || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
    "|": (firstLine.match(/\|/g) || []).length,
  };
  // Prefer comma > tab > pipe when ambiguous
  const sorted = Object.entries(counts).sort((a, b) => {
    if (a[1] === b[1]) {
      const order = [",", "\t", "|"];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    }
    return b[1] - a[1];
  });
  return sorted[0]?.[0] ?? ",";
}
