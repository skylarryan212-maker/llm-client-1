import YAML from "yaml";
import TOML from "@iarna/toml";
import { collectStructuredStats } from "../utils/stats";
import { truncateUtf8 } from "../utils/text";
import type { Extractor } from "../types";

export const structuredExtractor: Extractor = async (
  buffer,
  name,
  mime,
  ctx,
) => {
  const lowerName = (name || "").toLowerCase();
  const lowerMime = (mime || "").toLowerCase();
  const text = buffer.toString("utf-8");

  const parsers: Array<{
    test: boolean;
    parse: () => unknown;
    kind: string;
  }> = [
    {
      test: true,
      parse: () => JSON.parse(text),
      kind: "json",
    },
    {
      test: lowerName.endsWith(".yaml") ||
        lowerName.endsWith(".yml") ||
        lowerMime.includes("yaml"),
      parse: () => YAML.parse(text),
      kind: "yaml",
    },
    {
      test: lowerName.endsWith(".toml") || lowerMime.includes("toml"),
      parse: () => TOML.parse(text),
      kind: "toml",
    },
  ];

  for (const parser of parsers) {
    if (!parser.test) continue;
    try {
      const parsed = parser.parse();
      const stats = collectStructuredStats(parsed);
      const preview = truncateUtf8(
        `${parser.kind.toUpperCase()} parsed\nKeys: ${stats.keyCount}\nMax depth: ${stats.maxDepth}\nArray lengths: ${stats.arrayLengths
          .map((a) => `${a.path || "[root]"}=${a.length}`)
          .join(", ")}\nPrimitive counts: ${JSON.stringify(stats.primitiveCounts, null, 2)}\nSample:\n${truncateUtf8(
          JSON.stringify(parsed, null, 2),
          8000,
        )}`,
      );
      return {
        preview,
        meta: {
          kind: "structured",
          size: ctx.size,
          status: "ok",
          stats: { ...stats, format: parser.kind },
        },
      };
    } catch {
      // continue to next parser
    }
  }

  return {
    preview: "Failed to parse structured text",
    meta: { kind: "structured", size: ctx.size, status: "parse_error" },
  };
};
