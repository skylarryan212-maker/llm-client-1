import { parseBuffer } from "music-metadata";

const BYTES_PER_SECOND = 18_000;

export async function measureAudioDurationSeconds(
  buffer: Buffer,
  fileName?: string,
  mimeType?: string
): Promise<number> {
  try {
    const metadata = await parseBuffer(buffer, fileName, { duration: true });
    const duration = metadata.format.duration;
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      return duration;
    }
  } catch {
    // Fall back to file-size heuristic if parsing fails
  }

  if (mimeType && typeof mimeType === "string" && mimeType.startsWith("audio/")) {
    return buffer.length / BYTES_PER_SECOND;
  }

  return buffer.length / BYTES_PER_SECOND;
}
