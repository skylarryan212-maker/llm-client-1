import { MAX_PREVIEW_BYTES } from "../config";
import type { Extractor } from "../types";
import { normalizeNewlines, truncateUtf8 } from "../utils/text";

const FN_REGEX =
  /\b(function\s+\w+|\w+\s*=\s*\([^)]*\)\s*=>|def\s+\w+|fn\s+\w+|\basync\s+\w*\s*\()/g;
const CLASS_REGEX = /\b(class|struct|interface)\s+\w+/g;
const IMPORT_REGEX = /\b(import\s+[^;]+;|from\s+['"][^'"]+['"]|#include\s+[<"][^>"]+[>"])/g;
const BRANCH_REGEX = /\b(if|for|while|case|catch|switch)\b/g;
const TODO_REGEX = /(TODO|FIXME)/i;

export const codeExtractor: Extractor = async (buffer, name, _mime, ctx) => {
  const raw = buffer.toString("utf-8");
  const text = normalizeNewlines(raw);
  const lines = text.split("\n");
  const fnMatches = text.match(FN_REGEX) || [];
  const classMatches = text.match(CLASS_REGEX) || [];
  const importMatches = Array.from(new Set((text.match(IMPORT_REGEX) || []).map((s) => s.trim()))).slice(0, 20);
  const branchMatches = text.match(BRANCH_REGEX) || [];
  const todos = lines
    .map((line, idx) => ({ line, idx: idx + 1 }))
    .filter(({ line }) => TODO_REGEX.test(line))
    .slice(0, 10)
    .map(({ line, idx }) => `${idx}: ${line.trim().slice(0, 200)}`);

  const summary = [
    `Lines: ${lines.length}`,
    `Functions: ${fnMatches.length}`,
    `Classes/Structs: ${classMatches.length}`,
    `Branches: ${branchMatches.length}`,
    `Imports (${importMatches.length}): ${importMatches.join(" | ")}`,
    todos.length ? `TODO/FIXME (${todos.length}): ${todos.join(" ; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const bodySample = truncateUtf8(text, MAX_PREVIEW_BYTES / 2);
  const preview = truncateUtf8(`${summary}\n---\n${bodySample}`);
  return {
    preview,
    meta: {
      kind: "code",
      size: ctx.size,
      status: preview ? "ok" : "empty",
      stats: {
        lines: lines.length,
        functions: fnMatches.length,
        classes: classMatches.length,
        branches: branchMatches.length,
        imports: importMatches,
        todos,
      },
    },
  };
};
