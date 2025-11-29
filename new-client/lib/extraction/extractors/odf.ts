import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { ARCHIVE_MAX_ENTRIES } from "../config";
import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  allowBooleanAttributes: true,
});

export const odfExtractor: Extractor = async (buffer, name, _mime, ctx) => {
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  const zip = await JSZip.loadAsync(buffer);
  const contentFile = zip.file("content.xml");
  if (!contentFile) {
    return {
      preview: "Missing content.xml in ODF container",
      meta: { kind: "odf", size: ctx.size, status: "parse_error" },
    };
  }
  const xmlStr = await contentFile.async("string");
  const parsed = parser.parse(xmlStr);

  if (ext === "ods") {
    const preview = extractOdsPreview(parsed);
    return {
      preview,
      meta: { kind: "odf", size: ctx.size, status: preview ? "ok" : "empty" },
    };
  }

  const text = extractOdtText(parsed);
  const preview = truncateUtf8(text);
  return {
    preview,
    meta: { kind: "odf", size: ctx.size, status: preview ? "ok" : "empty" },
  };
};

function toRecord(value: unknown): XmlRecord | undefined {
  return value && typeof value === "object" ? (value as XmlRecord) : undefined;
}

function toArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === undefined || value === null) return [];
  return [value as T];
}

function extractOdtText(parsed: unknown): string {
  const texts: string[] = [];
  const doc = toRecord(parsed)?.["office:document-content"];
  const body = toRecord(toRecord(doc)?.["office:body"])?.["office:text"];
  if (!body) return "";
  const walk = (node: unknown) => {
    if (!node) return;
    if (typeof node === "string") {
      texts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    Object.values(node).forEach(walk);
  };
  walk(body);
  return texts.join(" ").replace(/\s+/g, " ").trim();
}

function extractOdsPreview(parsed: unknown): string {
  const spreadsheet = toRecord(
    toRecord(toRecord(parsed)?.["office:document-content"])?.["office:body"],
  )?.["office:spreadsheet"];
  if (!spreadsheet) return "";
  const tables = (spreadsheet as XmlRecord)["table:table"];
  const tableArr = toArray<unknown>(tables);
  const parts: string[] = [];
  tableArr.slice(0, 3).forEach((table, idx: number) => {
    const rows = toRecord(table)?.["table:table-row"];
    const rowArr = toArray<unknown>(rows);
    parts.push(`[Sheet ${idx + 1}]`);
    rowArr.slice(0, 50).forEach((row) => {
      const cells = toRecord(row)?.["table:table-cell"];
      const cellArr = toArray<unknown>(cells);
      const rowText = cellArr
        .slice(0, ARCHIVE_MAX_ENTRIES)
        .map((cell) => extractCellText(cell))
        .join("\t");
      parts.push(rowText);
    });
  });
  return truncateUtf8(parts.join("\n"));
}

function extractCellText(cell: unknown): string {
  if (!cell) return "";
  const textP = toRecord(cell)?.["text:p"];
  if (typeof textP === "string") return textP;
  if (Array.isArray(textP)) return textP.join(" ");
  if (typeof textP === "object" && textP !== null) {
    return Object.values(textP)
      .map((v) => (typeof v === "string" ? v : ""))
      .join(" ");
  }
  return "";
}
