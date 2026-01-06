type HumanizeParams = {
  text: string;
  model: string;
  language?: string;
  words?: boolean;
  costs?: boolean;
};

type DetectParams = {
  text: string;
  mode?: string;
};

const HUMANIZE_URL = "https://v2-humanizer.rephrasy.ai/api";
const DETECT_URL = "https://detector.rephrasy.ai/detect_api";
const DEFAULT_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

function requireApiKey(): string {
  const apiKey = process.env.REPHRASY_API_KEY || process.env.REPHRASY_API_TOKEN;
  if (!apiKey) {
    throw new Error("Missing REPHRASY_API_KEY");
  }
  return apiKey;
}

export async function rephrasyHumanize(params: HumanizeParams) {
  const apiKey = requireApiKey();
  const body: Record<string, unknown> = {
    text: params.text,
    model: params.model || "undetectable",
    costs: params.costs ?? false,
  };
  if (params.language && params.language !== "auto") body.language = params.language;
  if (typeof params.words === "boolean") body.words = params.words;

  const res = await fetchWithTimeout(
    HUMANIZE_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    DEFAULT_TIMEOUT_MS
  );

  const text = await res.text().catch(() => "");
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const message =
      typeof json?.error === "string"
        ? json.error
        : res.statusText || "rephrasy_error";
    const err = new Error(`Rephrasy humanize failed (${res.status}): ${message}`);
    (err as any).status = res.status;
    (err as any).bodySnippet = text.slice(0, 400);
    throw err;
  }

  const output = typeof json.output === "string" ? json.output : params.text;
  const flesch = typeof json.new_flesch_score === "number" ? json.new_flesch_score : null;
  return {
    output,
    flesch,
    raw: json,
  };
}

export async function rephrasyDetect(params: DetectParams) {
  const apiKey = requireApiKey();
  const body: Record<string, unknown> = {
    text: params.text,
  };
  if (params.mode) body.mode = params.mode;

  const res = await fetchWithTimeout(
    DETECT_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    DEFAULT_TIMEOUT_MS
  );

  const text = await res.text().catch(() => "");
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }

  if (!res.ok) {
    const message =
      typeof json?.error === "string"
        ? json.error
        : res.statusText || "rephrasy_error";
    const err = new Error(`Rephrasy detect failed (${res.status}): ${message}`);
    (err as any).status = res.status;
    (err as any).bodySnippet = text.slice(0, 400);
    throw err;
  }

  const overall = Number((json as any)?.scores?.overall ?? (json as any)?.overall);
  const rawOverall = Number.isFinite(overall) ? overall : null;
  return {
    rawOverall,
    raw: json,
  };
}

export function computeHumanScore(rawOverall: number | null, mode?: string): number | null {
  if (rawOverall === null || !Number.isFinite(rawOverall)) return null;
  const score = Math.max(0, Math.min(100, rawOverall));

  // Docs conflict: "depth" mode uses 0=human/100=AI; other modes sometimes say 100=human.
  if (mode === "depth") return 100 - score;
  if (score <= 50) return 100 - score; // assume lower score means more human for the default mode sample
  return score; // fallback: assume higher=more human when mode isn't "depth"
}
