export function bufferToString(buffer: Buffer, maxBytes?: number): string {
  if (typeof maxBytes === "number" && maxBytes >= 0) {
    return buffer.subarray(0, maxBytes).toString("utf-8");
  }
  return buffer.toString("utf-8");
}

export function sanitizeEntryPath(path: string): string {
  const cleaned = path.replace(/\\/g, "/");
  if (cleaned.includes("..")) {
    return cleaned
      .split("/")
      .filter((part) => part !== ".." && part !== "")
      .join("/");
  }
  return cleaned.startsWith("/") ? cleaned.slice(1) : cleaned;
}

export function isLikelyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  const nonPrintable = sample.filter((b) => b === 0 || b === 255).length;
  return nonPrintable <= sample.length * 0.1;
}
