import { ENABLE_LEGACY_CONVERT } from "../config";
import type { Extractor } from "../types";

export const legacyOfficeExtractor: Extractor = async (_buffer, name, _mime, ctx) => {
  if (!ENABLE_LEGACY_CONVERT) {
    return {
      preview: "Legacy Office conversion disabled. Set ENABLE_LEGACY_CONVERT=true to enable conversion path.",
      meta: { kind: "legacy_office", size: ctx.size, status: "unsupported" },
    };
  }

  // Placeholder hook for future conversion implementation
  return {
    preview: "Conversion placeholder for legacy Office format.",
    meta: {
      kind: "legacy_office",
      size: ctx.size,
      status: "unsupported",
      notes: ["Conversion pipeline not implemented"],
    },
  };
};
