import { NextResponse } from "next/server";
import { chromium } from "playwright";

export const runtime = "nodejs";

type RenderRequest = {
  url?: string;
  timeoutMs?: number;
  maxBytes?: number;
};

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function renderWithPlaywright(url: string, timeoutMs: number, maxBytes: number) {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
  }
  const proxyHost = process.env.BRIGHTDATA_PROXY_HOST;
  const proxyPort = process.env.BRIGHTDATA_PROXY_PORT;
  const proxyUser = process.env.BRIGHTDATA_PROXY_USER;
  const proxyPass = process.env.BRIGHTDATA_PROXY_PASS;
  const proxyServer =
    proxyHost && proxyPort
      ? `${proxyHost.startsWith("http") ? "" : "http://"}${proxyHost}:${proxyPort}`
      : null;

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(proxyServer
        ? {
            proxy: {
              server: proxyServer,
              username: proxyUser || undefined,
              password: proxyPass || undefined,
            },
          }
        : {}),
    });
  } catch (error) {
    console.warn("[web-render] Headless launch failed", { url, error });
    return { html: "", text: "" };
  }

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1366, height: 768 },
      ...(proxyServer ? { ignoreHTTPSErrors: true } : {}),
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    await page.waitForTimeout(500);
    const html = await page.content();
    let text = "";
    try {
      text = await page.evaluate(() => document.body?.innerText ?? "");
    } catch {
      text = "";
    }
    await context.close();
    const slicedHtml = html.length > maxBytes ? html.slice(0, maxBytes) : html;
    const slicedText = text.length > maxBytes ? text.slice(0, maxBytes) : text;
    return { html: slicedHtml, text: normalizeWhitespace(slicedText) };
  } catch (error) {
    console.warn("[web-render] Render failed", { url, error });
    return { html: "", text: "" };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function POST(request: Request) {
  let payload: RenderRequest;
  try {
    payload = (await request.json()) as RenderRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!payload?.url || typeof payload.url !== "string") {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(payload.url);
  } catch {
    return NextResponse.json({ error: "Invalid url." }, { status: 400 });
  }
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return NextResponse.json({ error: "Unsupported url protocol." }, { status: 400 });
  }

  const timeoutMs =
    typeof payload.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
      ? Math.min(Math.max(payload.timeoutMs, 1000), 60_000)
      : 12_000;
  const maxBytes =
    typeof payload.maxBytes === "number" && Number.isFinite(payload.maxBytes)
      ? Math.min(Math.max(payload.maxBytes, 16_000), 8 * 1024 * 1024)
      : 8 * 1024 * 1024;

  const result = await renderWithPlaywright(payload.url, timeoutMs, maxBytes);
  return NextResponse.json(result);
}
