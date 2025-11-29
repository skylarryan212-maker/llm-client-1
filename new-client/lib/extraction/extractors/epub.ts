import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { convert } from "html-to-text";
import { truncateUtf8 } from "../utils/text";
import type { Extractor } from "../types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
});

export const epubExtractor: Extractor = async (buffer, _name, _mime, ctx) => {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const containerFile = zip.file("META-INF/container.xml");
    if (!containerFile) {
      return {
        preview: "Invalid EPUB: missing container.xml",
        meta: { kind: "epub", size: ctx.size, status: "parse_error" },
      };
    }
    const containerXml = await containerFile.async("string");
    const container = parser.parse(containerXml);
    const rootPath =
      container?.container?.rootfiles?.rootfile?.["full-path"] ||
      container?.container?.rootfiles?.rootfile?.["fullpath"];
    if (!rootPath || !zip.file(rootPath)) {
      return {
        preview: "Invalid EPUB: missing package.opf",
        meta: { kind: "epub", size: ctx.size, status: "parse_error" },
      };
    }

    const opfXml = await zip.file(rootPath)!.async("string");
    const opf = parser.parse(opfXml);
    const manifestArr = opf?.package?.manifest?.item;
    const spineArr = opf?.package?.spine?.itemref;
    const manifest: Record<string, string> = {};
    const manifestItems = Array.isArray(manifestArr)
      ? manifestArr
      : manifestArr
        ? [manifestArr]
        : [];
    manifestItems.forEach((item) => {
      const rec = item as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : null;
      const href = typeof rec.href === "string" ? rec.href : null;
      if (id && href) {
        manifest[id] = href;
      }
    });

    const spineItems = Array.isArray(spineArr)
      ? spineArr
      : spineArr
        ? [spineArr]
        : [];
    const baseDir = rootPath.includes("/") ? rootPath.slice(0, rootPath.lastIndexOf("/") + 1) : "";
    const texts: string[] = [];

    for (const itemRef of spineItems.slice(0, 50)) {
      const idref =
        itemRef && typeof (itemRef as Record<string, unknown>).idref === "string"
          ? (itemRef as Record<string, unknown>).idref
          : null;
      if (!idref) continue;
      const href = manifest[idref];
      if (!href) continue;
      const fullPath = `${baseDir}${href}`.replace(/\\/g, "/");
      const file = zip.file(fullPath);
      if (!file) continue;
      const html = await file.async("string");
      const text = convert(html, {
        wordwrap: false,
        selectors: [
          { selector: "script", format: "skip" },
          { selector: "style", format: "skip" },
        ],
      });
      if (text.trim()) {
        texts.push(text.trim());
      }
      const joined = texts.join("\n\n");
      if (Buffer.byteLength(joined, "utf-8") > 32000) break;
    }

    const preview = truncateUtf8(texts.join("\n\n"));
    return {
      preview,
      meta: {
        kind: "epub",
        size: ctx.size,
        status: preview ? "ok" : "empty",
        notes: [
          `Chapters processed: ${texts.length}`,
          ...(spineItems.length > texts.length
            ? [`Truncated after ${texts.length} spine items`]
            : []),
        ],
      },
    };
  } catch (err) {
    return {
      preview: "EPUB extraction failed",
      meta: { kind: "epub", size: ctx.size, status: "parse_error", notes: [String(err)] },
    };
  }
};
