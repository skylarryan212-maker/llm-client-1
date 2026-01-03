type DataForSeoCredentials = {
  username: string;
  password: string;
};

export type DataForSeoSerpRequest = {
  keyword: string;
  locationName?: string;
  languageCode?: string;
  device?: "desktop" | "mobile";
  depth?: number;
  searchEngine?: string;
};

export type DataForSeoOrganicResult = {
  url: string;
  title: string;
  description?: string | null;
  position?: number | null;
  domain?: string | null;
};

export type DataForSeoSerpResponse = {
  taskId: string | null;
  results: DataForSeoOrganicResult[];
  raw: unknown;
};

const DEFAULT_LOCATION_NAME = "United States";
const DEFAULT_LANGUAGE_CODE = "en";
const DEFAULT_DEVICE = "desktop";
const DEFAULT_DEPTH = 10;
const DEFAULT_ENGINE = "google.com";

function getCredentials(): DataForSeoCredentials | null {
  const username = process.env.DATAFORSEO_USER;
  const password = process.env.DATAFORSEO_PASS;
  if (!username || !password) {
    console.warn("[dataforseo] Missing DATAFORSEO_USER or DATAFORSEO_PASS.");
    return null;
  }
  return { username, password };
}

function buildAuthHeader({ username, password }: DataForSeoCredentials): string {
  const token = Buffer.from(`${username}:${password}`).toString("base64");
  return `Basic ${token}`;
}

export async function fetchGoogleOrganicSerp(
  request: DataForSeoSerpRequest
): Promise<DataForSeoSerpResponse> {
  const credentials = getCredentials();
  if (!credentials) {
    return { taskId: null, results: [], raw: null };
  }

  const payload = [
    {
      keyword: request.keyword,
      location_name: request.locationName ?? DEFAULT_LOCATION_NAME,
      language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
      device: request.device ?? DEFAULT_DEVICE,
      depth: request.depth ?? DEFAULT_DEPTH,
      se_domain: request.searchEngine ?? DEFAULT_ENGINE,
    },
  ];

  const response = await fetch(
    "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
    {
      method: "POST",
      headers: {
        Authorization: buildAuthHeader(credentials),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const bodyText = await response.text();
  let data: any = null;
  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error("[dataforseo] SERP error", {
      status: response.status,
      statusText: response.statusText,
      body: bodyText,
    });
    return { taskId: null, results: [], raw: data ?? bodyText };
  }

  const task = Array.isArray(data?.tasks) ? data.tasks[0] : null;
  const taskId = typeof task?.id === "string" ? task.id : null;
  const items = Array.isArray(task?.result?.[0]?.items) ? task.result[0].items : [];
  const results: DataForSeoOrganicResult[] = items
    .filter((item: any) => item && item.type === "organic" && typeof item.url === "string")
    .map((item: any) => ({
      url: item.url as string,
      title: typeof item.title === "string" ? item.title : item.url,
      description: typeof item.description === "string" ? item.description : null,
      position: typeof item.rank_group === "number" ? item.rank_group : null,
      domain: typeof item.domain === "string" ? item.domain : null,
    }));

  return { taskId, results, raw: data };
}
