// lib/conversation-utils.ts

const PLACEHOLDER_TITLES = [
  "",
  "new chat",
  "untitled chat",
  "conversation with assistant",
  "chat with assistant",
];

export function isPlaceholderTitle(value: string | null | undefined): boolean {
  const normalized = (value || "").trim().toLowerCase();
  return PLACEHOLDER_TITLES.includes(normalized);
}

export function normalizeGeneratedTitle(input: string | null | undefined): string | null {
  const cleaned = (input || "")
    .replace(/["'""'']+/g, "")
    .replace(/[.!?,:;]+$/g, "")
    .trim();
  
  if (!cleaned) {
    return null;
  }
  
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  
  const truncated = words.slice(0, 8).join(" ");
  if (!truncated) return null;
  
  const normalized = truncated.trim();
  if (isPlaceholderTitle(normalized)) {
    return null;
  }
  
  return normalized;
}
