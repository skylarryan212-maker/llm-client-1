import * as pdfjsLib from "pdfjs-dist";
import { PDF_MAX_PAGES } from "../config";
import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";

type PdfTextItem = {
  str?: string;
  unicode?: string;
};

export const pdfExtractor: Extractor = async (buffer, _name, _mime, ctx) => {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;
    const maxPages = Math.min(pdf.numPages, PDF_MAX_PAGES);
    const parts: string[] = [];
    for (let i = 1; i <= maxPages; i += 1) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: PdfTextItem) =>
          typeof item.str === "string"
            ? item.str
            : typeof item.unicode === "string"
              ? item.unicode
              : "",
        )
        .filter(Boolean)
        .join(" ");
      if (pageText.trim()) {
        parts.push(pageText.trim());
      }
      const current = parts.join("\n\n");
      if (Buffer.byteLength(current, "utf-8") > 32000) break;
    }
    const text = truncateUtf8(parts.join("\n\n"));
    return {
      preview: text,
      meta: {
        kind: "pdf",
        size: ctx.size,
        status: text ? "ok" : "empty",
        notes:
          pdf.numPages > maxPages
            ? [`Truncated at ${maxPages} pages`]
            : undefined,
      },
    };
  } catch (err) {
    return {
      preview: "PDF extraction failed",
      meta: { kind: "pdf", size: ctx.size, status: "parse_error", notes: [String(err)] },
    };
  }
};
