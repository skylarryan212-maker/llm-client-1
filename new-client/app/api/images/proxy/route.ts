export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // slightly above thumbnail needs
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);

function isPrivateIpAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:")) return true;
  return false;
}

async function assertPublicHostname(url: URL): Promise<void> {
  const hostname = url.hostname.toLowerCase();
  if (!hostname) throw new Error("Invalid hostname");
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Blocked hostname");
  }
  const ipLiteral = isIP(hostname);
  if (ipLiteral) {
    if (isPrivateIpAddress(hostname)) throw new Error("Blocked private IP");
    return;
  }
  const records = await lookup(hostname, { all: true });
  for (const r of records) {
    if (r?.address && isPrivateIpAddress(r.address)) {
      throw new Error("Blocked private DNS resolution");
    }
  }
}

async function fetchWithRedirectChecks(url: URL): Promise<Response> {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    await assertPublicHostname(current);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "llm-client/image-proxy",
          Accept: "image/*,text/html;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      const next = new URL(loc, current);
      current = next;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

function extractOgImageUrl(html: string, baseUrl: URL): string | null {
  const meta =
    html.match(/<meta[^>]+property=(['\"])og:image\1[^>]+>/i) ||
    html.match(/<meta[^>]+name=(['\"])og:image\1[^>]+>/i) ||
    null;
  if (!meta) return null;
  const content = meta[0].match(/content=(['\"])(.*?)\\1/i)?.[2];
  if (!content) return null;
  try {
    const u = new URL(content, baseUrl);
    return u.toString();
  } catch {
    return null;
  }
}

async function readLimitedArrayBuffer(res: Response, maxBytes: number): Promise<ArrayBuffer> {
  const contentLength = Number(res.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Image too large");
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new Error("Image too large");
  return buf;
}

export async function GET(req: NextRequest): Promise<Response> {
  const urlParam = req.nextUrl.searchParams.get("url") || "";
  if (!urlParam || urlParam.length > 4096) {
    return new Response("Missing url", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(urlParam);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }
  if (!/^https?:$/i.test(target.protocol)) {
    return new Response("Unsupported protocol", { status: 400 });
  }

  try {
    const first = await fetchWithRedirectChecks(target);
    const contentType = (first.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();

    // Direct image bytes.
    if (ALLOWED_IMAGE_MIME_TYPES.has(contentType)) {
      const buf = await readLimitedArrayBuffer(first, MAX_IMAGE_BYTES);
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      });
    }

    // HTML page: try OG image.
    if (contentType.startsWith("text/html")) {
      const htmlBuf = await readLimitedArrayBuffer(first, Math.min(MAX_IMAGE_BYTES, 512_000));
      const html = new TextDecoder("utf-8").decode(htmlBuf);
      const baseForOg = (() => {
        try {
          return new URL(first.url || target.toString());
        } catch {
          return target;
        }
      })();
      const og = extractOgImageUrl(html, baseForOg);
      if (!og) return new Response("No image found", { status: 415 });
      const ogUrl = new URL(og);
      const ogRes = await fetchWithRedirectChecks(ogUrl);
      const ogType = (ogRes.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_MIME_TYPES.has(ogType)) {
        return new Response("Unsupported image type", { status: 415 });
      }
      const ogBuf = await readLimitedArrayBuffer(ogRes, MAX_IMAGE_BYTES);
      return new Response(ogBuf, {
        status: 200,
        headers: {
          "Content-Type": ogType,
          "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        },
      });
    }

    return new Response("Unsupported content", { status: 415 });
  } catch {
    return new Response("Fetch failed", { status: 502 });
  }
}
