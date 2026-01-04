import { NextResponse } from "next/server";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium as playwrightChromium } from "playwright-core";
import chromium from "@sparticuz/chromium";

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
  const proxyHost = process.env.BRIGHTDATA_PROXY_HOST;
  const proxyPort = process.env.BRIGHTDATA_PROXY_PORT;
  const proxyUser = process.env.BRIGHTDATA_PROXY_USER;
  const proxyPass = process.env.BRIGHTDATA_PROXY_PASS;
  const proxyServer =
    proxyHost && proxyPort
      ? `${proxyHost.startsWith("http") ? "" : "http://"}${proxyHost}:${proxyPort}`
      : null;

  let browser: any = null;
  try {
    const originalAwsEnv = process.env.AWS_EXECUTION_ENV;
    // Force Lambda-like env so Sparticuz extracts bundled system libs (nss, etc.)
    if (!originalAwsEnv) {
      process.env.AWS_EXECUTION_ENV = "AWS_Lambda_nodejs20.x";
    }
    const rawExecutablePath = await chromium.executablePath();
    const executablePath = typeof rawExecutablePath === "string" ? rawExecutablePath : undefined;
    if (!executablePath) {
      console.warn("[web-render] chromium executablePath unavailable", {
        value: rawExecutablePath,
      });
    }
    if (!originalAwsEnv) {
      delete process.env.AWS_EXECUTION_ENV;
    } else {
      process.env.AWS_EXECUTION_ENV = originalAwsEnv;
    }
    const args = chromium.args ?? [];
    const headless = chromium.headless === "shell" ? true : chromium.headless ?? true;
    const execDir = executablePath ? path.dirname(executablePath) : undefined;
    const parentDir = execDir ? path.dirname(execDir) : undefined;
    let chromiumPackageRoot: string | null = null;
    try {
      const require = createRequire(import.meta.url);
      const resolved = require.resolve("@sparticuz/chromium/package.json");
      if (typeof resolved === "string") {
        chromiumPackageRoot = path.dirname(resolved);
      }
    } catch {
      chromiumPackageRoot = null;
    }
    const packageLibPath = chromiumPackageRoot ? path.join(chromiumPackageRoot, "lib") : undefined;
    const packageBinPath = chromiumPackageRoot ? path.join(chromiumPackageRoot, "bin") : undefined;
    const chromiumLibPath = (chromium as { libPath?: string; libraryPath?: string }).libPath
      ?? (chromium as { libPath?: string; libraryPath?: string }).libraryPath;
    const bundledLibPath = execDir ? path.join(execDir, "lib") : undefined;
    const extractedLibPath = executablePath ? path.join(executablePath, "lib") : undefined;
    const env: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }
    const ldPath = [
      bundledLibPath,
      extractedLibPath,
      execDir,
      parentDir ? path.join(parentDir, "lib") : undefined,
      parentDir,
      packageLibPath,
      packageBinPath,
      chromiumLibPath,
      process.env.LD_LIBRARY_PATH,
    ]
      .filter(Boolean)
      .join(":");
    if (ldPath) {
      env.LD_LIBRARY_PATH = ldPath;
      process.env.LD_LIBRARY_PATH = ldPath;
    }
    browser = await playwrightChromium.launch({
      headless,
      args,
      executablePath,
      chromiumSandbox: false,
      env,
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
      ignoreHTTPSErrors: true,
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
