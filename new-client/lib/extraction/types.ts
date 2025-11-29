export interface ExtractionMeta {
  kind: string;
  size: number;
  status: "ok" | "too_large" | "unsupported" | "parse_error" | "encrypted" | "empty";
  notes?: string[];
  stats?: Record<string, unknown>;
}

export interface ExtractionResult {
  preview: string | null;
  meta: ExtractionMeta;
}

export type Extractor = (
  buffer: Buffer,
  name: string,
  mime: string | null,
  ctx: { size: number },
) => Promise<ExtractionResult>;
