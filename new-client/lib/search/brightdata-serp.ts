import { extractDomainFromUrl } from "@/lib/metadata";

export type BrightDataSerpRequest = {
  keyword: string;
  depth?: number;
  searchEngine?: string;
  gl?: string;
  hl?: string;
};

export type BrightDataOrganicResult = {
  url: string;
  title: string;
  description?: string | null;
  position?: number | null;
  domain?: string | null;
};

export type BrightDataSerpResponse = {
  taskId: string | null;
  results: BrightDataOrganicResult[];
  raw: unknown;
  requestCount: number;
};

const DEFAULT_DEPTH = 10;
const MAX_DEPTH = 30;
const PAGE_SIZE = 10;
const DEFAULT_ENGINE = "google.com";
const LOG_RAW_SERP =
  typeof process.env.BRIGHTDATA_LOG_SERP_RAW === "undefined"
    ? true
    : process.env.BRIGHTDATA_LOG_SERP_RAW === "true";

function getCredentials() {
  const apiKey = process.env.BRIGHTDATA_SERP_API_KEY;
  const zone = process.env.BRIGHTDATA_SERP_ZONE;
  if (!apiKey || !zone) {
    console.warn("[brightdata] Missing BRIGHTDATA_SERP_API_KEY or BRIGHTDATA_SERP_ZONE.");
    return null;
  }
  return { apiKey, zone };
}

function parseResults(payload: any): BrightDataOrganicResult[] {
  const candidates: any[] = [];
  if (Array.isArray(payload?.organic?.results)) candidates.push(...payload.organic.results);
  if (Array.isArray(payload?.organic_results)) candidates.push(...payload.organic_results);
  if (Array.isArray(payload?.organic)) candidates.push(...payload.organic);
  if (Array.isArray(payload?.results)) candidates.push(...payload.results);
  if (Array.isArray(payload?.data?.results)) candidates.push(...payload.data.results);
  if (Array.isArray(payload?.data?.organic_results)) candidates.push(...payload.data.organic_results);
  if (Array.isArray(payload?.data?.organic?.results)) candidates.push(...payload.data.organic.results);

  const output: BrightDataOrganicResult[] = [];
  for (const item of candidates) {
    const url =
      (typeof item?.url === "string" && item.url) ||
      (typeof item?.link === "string" && item.link) ||
      (typeof item?.href === "string" && item.href) ||
      "";
    if (!url) continue;
    const title =
      (typeof item?.title === "string" && item.title) ||
      (typeof item?.name === "string" && item.name) ||
      url;
    const description =
      (typeof item?.description === "string" && item.description) ||
      (typeof item?.snippet === "string" && item.snippet) ||
      (typeof item?.subtitle === "string" && item.subtitle) ||
      null;
    const position =
      typeof item?.position === "number"
        ? item.position
        : typeof item?.rank === "number"
          ? item.rank
          : typeof item?.index === "number"
            ? item.index
            : null;
    output.push({
      url,
      title,
      description,
      position,
      domain:
        (typeof item?.domain === "string" && item.domain) ||
        extractDomainFromUrl(url) ||
        null,
    });
  }
  return output;
}

export async function fetchGoogleOrganicSerp(
  request: BrightDataSerpRequest
): Promise<BrightDataSerpResponse> {
  const credentials = getCredentials();
  if (!credentials) {
    return { taskId: null, results: [], raw: null, requestCount: 0 };
  }

  const baseUrl = new URL("https://www.google.com/search");
  const keyword = request.keyword.trim();
  if (keyword) {
    baseUrl.searchParams.set("q", keyword);
  }
  const depth = Math.min(Math.max(request.depth ?? DEFAULT_DEPTH, 1), MAX_DEPTH);
  if (request.gl) {
    baseUrl.searchParams.set("gl", request.gl.toLowerCase());
  }
  if (request.hl) {
    baseUrl.searchParams.set("hl", request.hl.toLowerCase());
  }
  if (request.searchEngine && request.searchEngine !== DEFAULT_ENGINE) {
    console.warn("[brightdata] Non-default search engine ignored; using google.com", {
      requested: request.searchEngine,
    });
  }

  const totalPages = Math.max(1, Math.ceil(depth / PAGE_SIZE));
  const allResults: BrightDataOrganicResult[] = [];
  const seen = new Set<string>();
  const rawPages: unknown[] = [];
  let requestCount = 0;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const start = pageIndex * PAGE_SIZE;
    const targetUrl = new URL(baseUrl.toString());
    if (start > 0) {
      targetUrl.searchParams.set("start", String(start));
    }

    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        zone: credentials.zone,
        url: targetUrl.toString(),
        format: "json",
      }),
    });
    requestCount += 1;

    const bodyText = await response.text();
    let data: any = null;
    try {
      data = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      data = null;
    }

    rawPages.push(data ?? bodyText);

    if (!response.ok) {
      console.error("[brightdata] SERP error", {
        status: response.status,
        statusText: response.statusText,
        body: bodyText,
        start,
      });
      break;
    }

    const inner =
      typeof data?.body === "string"
        ? (() => {
            try {
              return JSON.parse(data.body);
            } catch {
              return null;
            }
          })()
        : data?.body && typeof data.body === "object"
          ? data.body
          : data;

    const pageResults = inner ? parseResults(inner) : [];
    if (LOG_RAW_SERP) {
      console.log("[brightdata] raw SERP", {
        keyword: request.keyword,
        depth,
        pageIndex,
        start,
        raw: data ?? bodyText,
        parsedResults: pageResults.length,
      });
    }
    if (!pageResults.length) {
      console.warn("[brightdata] SERP returned no items", {
        keyword: request.keyword,
        depth,
        pageIndex,
        start,
        raw: data ?? bodyText,
      });
      break;
    }

    for (const item of pageResults) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      allResults.push(item);
      if (allResults.length >= depth) break;
    }

    if (allResults.length >= depth) break;
  }

  return {
    taskId: null,
    results: allResults.slice(0, depth),
    raw: rawPages.length === 1 ? rawPages[0] : rawPages,
    requestCount,
  };
}
