import { formatPreview } from "../utils/text";
import type { Extractor } from "../types";

export const fallbackExtractor: Extractor = async (
  _buffer,
  name,
  _mime,
  ctx,
) => {
  const label = name || "file";
  const note = `Unsupported file type for ${label}`;
  return {
    preview: formatPreview("unsupported", note),
    meta: {
      kind: "unsupported",
      size: ctx.size,
      status: "unsupported",
      notes: [note],
    },
  };
};
