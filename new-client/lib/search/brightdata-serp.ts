import { extractDomainFromUrl } from "@/lib/metadata";

export type BrightDataSerpRequest = {
  keyword: string;
  depth?: number;
  searchEngine?: string;
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
};

const DEFAULT_DEPTH = 10;
const DEFAULT_ENGINE = "google.com";

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
    return { taskId: null, results: [], raw: null };
  }

  const targetUrl = new URL("https://www.google.com/search");
  const keyword = request.keyword.trim();
  if (keyword) {
    targetUrl.searchParams.set("q", keyword);
  }
  const depth = Math.min(Math.max(request.depth ?? DEFAULT_DEPTH, 1), 10);
  if (request.searchEngine && request.searchEngine !== DEFAULT_ENGINE) {
    console.warn("[brightdata] Non-default search engine ignored; using google.com", {
      requested: request.searchEngine,
    });
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

  const bodyText = await response.text();
  let data: any = null;
  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error("[brightdata] SERP error", {
      status: response.status,
      statusText: response.statusText,
      body: bodyText,
    });
    return { taskId: null, results: [], raw: data ?? bodyText };
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

  const results = inner ? parseResults(inner) : [];
  if (!results.length) {
    console.warn("[brightdata] SERP returned no items", {
      keyword: request.keyword,
      depth,
      raw: data ?? bodyText,
    });
  }

  return { taskId: null, results, raw: data ?? bodyText };
}
