// Load pdf.js dynamically to handle different package entry paths across environments
let pdfjsLibPromise: Promise<any> | null = null;
async function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      try {
        // Preferred: legacy build without DOM dependencies
        const mod = await import("pdfjs-dist/legacy/build/pdf");
        return mod;
      } catch {
        try {
          // Fallback: classic build
          const mod = await import("pdfjs-dist/build/pdf");
          return mod;
        } catch (err) {
          throw err;
        }
      }
    })();
  }
  return pdfjsLibPromise;
}
function ensureDomPolyfills() {
  if (typeof globalThis.DOMMatrix === "undefined") {
    // Minimal stub just so pdfjs dist can instantiate matrices.
    class DOMMatrixStub {
      constructor(_init?: any) {
        void _init;
      }
      multiplySelf() {
        return this;
      }
    }
    (globalThis as any).DOMMatrix = DOMMatrixStub;
  }
  if (typeof globalThis.ImageData === "undefined") {
    (globalThis as any).ImageData = class {
      constructor(public width: number, public height: number) {
        this.width = width;
        this.height = height;
      }
      data = new Uint8ClampedArray(0);
    };
  }
  if (typeof globalThis.Path2D === "undefined") {
    (globalThis as any).Path2D = class {
      constructor(_path?: string | Path2D) {
        void _path;
      }
    };
  }
}
import { PDF_MAX_PAGES } from "../config";
import type { Extractor } from "../types";
import { truncateUtf8 } from "../utils/text";

export const pdfExtractor: Extractor = async (buffer, _name, _mime, ctx) => {
  try {
    ensureDomPolyfills();
    const pdfjsLib = await loadPdfJs();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorker: false });
    const pdf = await loadingTask.promise;
    const maxPages = Math.min(pdf.numPages, PDF_MAX_PAGES);
    const parts: string[] = [];
    for (let i = 1; i <= maxPages; i += 1) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) =>
          typeof (item as { str?: unknown }).str === "string"
            ? (item as { str: string }).str
            : typeof (item as { unicode?: unknown }).unicode === "string"
              ? (item as { unicode: string }).unicode
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
