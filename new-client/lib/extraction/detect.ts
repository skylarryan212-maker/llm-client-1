import { isLikelyText } from "./utils/buffer";

const CODE_EXTENSIONS = [
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "java",
  "cpp",
  "c",
  "h",
  "cs",
  "php",
  "rb",
  "go",
  "rs",
  "swift",
  "kt",
  "kts",
  "m",
  "mm",
  "scala",
];

const STRUCTURED_EXTENSIONS = ["json", "yaml", "yml", "toml"];
const DELIM_EXTENSIONS = ["csv", "tsv", "psv"];
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "tiff", "bmp"];
const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "ogg", "webm", "flac"];
const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi"];

function getExt(name: string) {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? parts.pop() ?? "" : "";
}

export function detectKind(
  buffer: Buffer,
  name: string,
  mime: string | null,
): string {
  const ext = getExt(name);
  const lowerMime = (mime || "").toLowerCase();
  const slice8 = buffer.subarray(0, 8);

  const isZip =
    slice8.length >= 4 &&
    slice8[0] === 0x50 &&
    slice8[1] === 0x4b &&
    slice8[2] === 0x03 &&
    slice8[3] === 0x04;
  const isGzip = slice8.length >= 2 && slice8[0] === 0x1f && slice8[1] === 0x8b;
  const isPdf =
    slice8.length >= 4 && slice8.toString("utf-8", 0, 4) === "%PDF";
  const isTarMagic =
    buffer.length > 265 &&
    buffer.subarray(257, 262).toString("utf-8") === "ustar";
  const isOle =
    slice8.length >= 8 &&
    slice8[0] === 0xd0 &&
    slice8[1] === 0xcf &&
    slice8[2] === 0x11 &&
    slice8[3] === 0xe0;
  const isRar =
    slice8.length >= 7 &&
    slice8[0] === 0x52 &&
    slice8[1] === 0x61 &&
    slice8[2] === 0x72 &&
    slice8[3] === 0x21 &&
    slice8[4] === 0x1a &&
    slice8[5] === 0x07 &&
    slice8[6] === 0x00;
  const is7z =
    slice8.length >= 6 &&
    slice8[0] === 0x37 &&
    slice8[1] === 0x7a &&
    slice8[2] === 0xbc &&
    slice8[3] === 0xaf &&
    slice8[4] === 0x27 &&
    slice8[5] === 0x1c;

  if (isPdf || ext === "pdf" || lowerMime.includes("pdf")) return "pdf";
  if (isRar || ext === "rar") return "unsupported";
  if (is7z || ext === "7z") return "unsupported";

  if (isZip) {
    if (["odt", "ods", "odp"].includes(ext)) return "odf";
    if (ext === "epub") return "epub";
    return "zip";
  }

  if (isGzip) return "gzip";
  if (isTarMagic || ext === "tar" || ext === "tgz") return "tar";
  if (ext === "epub") return "epub";
  if (["odt", "ods", "odp"].includes(ext)) return "odf";
  if (lowerMime.includes("epub")) return "epub";

  if (ext === "ndjson" || ext === "jsonl" || lowerMime.includes("ndjson")) {
    return "ndjson";
  }
  if (DELIM_EXTENSIONS.includes(ext) || lowerMime.includes("csv")) return "tsv";
  if (ext === "log" || lowerMime.includes("log")) return "log";
  if (STRUCTURED_EXTENSIONS.includes(ext)) return "structured";
  if (lowerMime.includes("json") || lowerMime.includes("yaml")) {
    return "structured";
  }
  if (ext === "rtf" || lowerMime.includes("rtf") || buffer
    .subarray(0, 5)
    .toString("utf-8")
    .startsWith("{\\rtf")) {
    return "rtf";
  }
  if (CODE_EXTENSIONS.includes(ext)) return "code";

  if (IMAGE_EXTENSIONS.some((e) => e === ext) || lowerMime.startsWith("image/"))
    return "image";
  if (AUDIO_EXTENSIONS.includes(ext) || lowerMime.startsWith("audio/"))
    return "audio";
  if (VIDEO_EXTENSIONS.includes(ext) || lowerMime.startsWith("video/"))
    return "video";

  if (isOle || ["doc", "ppt", "xls"].includes(ext)) return "legacy_office";

  if (isLikelyText(buffer) || lowerMime.startsWith("text/")) return "text";

  return "unsupported";
}
