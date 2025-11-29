import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";

export const rtfExtractor: Extractor = async (buffer, _name, _mime, ctx) => {
  const raw = buffer.toString("utf-8");
  let text = raw
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\tab/g, "\t")
    .replace(/\\row/g, "\n")
    .replace(/\\cell/g, "\t")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-zA-Z]+\d* ?/g, " ")
    .replace(/[{}]/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n").replace(/\s+\n/g, "\n").trim();
  const preview = truncateUtf8(text);
  return {
    preview,
    meta: { kind: "rtf", size: ctx.size, status: preview ? "ok" : "empty" },
  };
};
