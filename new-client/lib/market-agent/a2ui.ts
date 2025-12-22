import { MarketSuggestionEvent } from "@/types/market-suggestion";

export const ALLOWED_CADENCES = [60, 120, 300, 600, 1800, 3600] as const;
export const WATCHLIST_LIMIT = 25;
export const MAX_SUGGESTIONS = 5;

export const SUGGESTION_SYSTEM_PROMPT = [
  "You generate UI-intent JSON for a suggestion card.",
  "You do NOT write UI; the application renders fixed templates.",
  "Only fill cadence interval + reason, optional watchlist tickers + reason (1-3 sentences each).",
  `Cadence interval must be one of ${ALLOWED_CADENCES.join(", ")} seconds and the reason should be conservative.`,
  "Watchlist suggestions should only surface when the user message or snapshot shows a missing relevant ticker.",
  "If the user explicitly asks to change cadence or add tickers, return a matching suggestion instead of returning empty.",
  "Return {\"events\": []} if no strong suggestion is justified.",
  "Do not repeat eventIds found in lastUiEventIds.",
  "Use the eventId format cadence:{intervalSeconds}:{YYYYMMDDHH}, watchlist:{sortedTickersJoinedByDash}:{YYYYMMDDHH}, or cadence-watchlist:{intervalSeconds}:{sortedTickersJoinedByDash}:{YYYYMMDDHH}, rounding the timestamp to the nearest hour.",
  `Limit watchlist suggestions to ${WATCHLIST_LIMIT} tickers or fewer.`,
  "Do not add any extra fields beyond the defined schema.",
].join(" ");

export const SUGGESTION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", const: "market_suggestion" },
          eventId: { type: "string" },
          cadence: {
            type: "object",
            properties: {
              intervalSeconds: { type: "integer", enum: ALLOWED_CADENCES },
              reason: { type: "string", minLength: 1 },
            },
            required: ["intervalSeconds", "reason"],
            additionalProperties: false,
          },
          watchlist: {
            type: "object",
            properties: {
              tickers: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: WATCHLIST_LIMIT,
              },
              reason: { type: "string", minLength: 1 },
            },
            required: ["tickers", "reason"],
            additionalProperties: false,
          },
        },
        required: ["kind", "eventId"],
        additionalProperties: false,
        anyOf: [
          {
            type: "object",
            properties: {
              kind: { type: "string", const: "market_suggestion" },
              eventId: { type: "string" },
              cadence: {
                type: "object",
                properties: {
                  intervalSeconds: { type: "integer", enum: ALLOWED_CADENCES },
                  reason: { type: "string", minLength: 1 },
                },
                required: ["intervalSeconds", "reason"],
                additionalProperties: false,
              },
            },
            required: ["kind", "eventId", "cadence"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", const: "market_suggestion" },
              eventId: { type: "string" },
              watchlist: {
                type: "object",
                properties: {
                  tickers: {
                    type: "array",
                    items: { type: "string" },
                    minItems: 1,
                    maxItems: WATCHLIST_LIMIT,
                  },
                  reason: { type: "string", minLength: 1 },
                },
                required: ["tickers", "reason"],
                additionalProperties: false,
              },
            },
            required: ["kind", "eventId", "watchlist"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["events"],
  additionalProperties: false,
};

const tickerPattern = /^[A-Z0-9.\-]{1,6}$/;

const sanitizeCadence = (cadence: any) => {
  if (!cadence || typeof cadence !== "object") return null;
  const intervalSeconds =
    typeof cadence.intervalSeconds === "number" && Number.isFinite(cadence.intervalSeconds)
      ? Math.round(cadence.intervalSeconds)
      : NaN;
  if (!intervalSeconds || !ALLOWED_CADENCES.includes(intervalSeconds as typeof ALLOWED_CADENCES[number])) {
    return null;
  }
  const reason = typeof cadence.reason === "string" ? cadence.reason.trim() : "";
  if (!reason) return null;
  return { intervalSeconds, reason };
};

const sanitizeWatchlist = (watchlist: any): { tickers: string[]; reason: string } | null => {
  if (!watchlist || typeof watchlist !== "object") return null;
  const rawTickers = Array.isArray(watchlist.tickers) ? (watchlist.tickers as unknown[]) : [];
  const normalizedTickers = rawTickers
    .map((ticker) => (typeof ticker === "string" ? ticker.trim().toUpperCase() : ""))
    .filter((ticker): ticker is string => Boolean(ticker) && tickerPattern.test(ticker));
  const tickers = Array.from(new Set<string>(normalizedTickers));
  if (!tickers.length || tickers.length > WATCHLIST_LIMIT) return null;
  const reason = typeof watchlist.reason === "string" ? watchlist.reason.trim() : "";
  if (!reason) return null;
  return { tickers, reason };
};

export const extractSuggestionEvents = (raw: unknown): MarketSuggestionEvent[] => {
  if (!raw || typeof raw !== "object") return [];
  const events = Array.isArray((raw as any).events) ? (raw as any).events : null;
  if (!events) return [];
  const result: MarketSuggestionEvent[] = [];
  for (const entry of events) {
    if (!entry || typeof entry !== "object") continue;
    if (entry?.kind !== "market_suggestion") continue;
    const eventId = typeof entry.eventId === "string" ? entry.eventId.trim() : "";
    if (!eventId) continue;
    const cadence = sanitizeCadence(entry.cadence);
    const watchlist = sanitizeWatchlist(entry.watchlist);
    if (!cadence && !watchlist) continue;
    result.push({
      kind: "market_suggestion",
      eventId,
      cadence: cadence ?? undefined,
      watchlist: watchlist ?? undefined,
    });
  }
  return result;
};

export const buildSuggestionContextMessage = (payload: {
  agentState: Record<string, unknown>;
  marketSnapshot: Record<string, unknown>;
  lastAnalysisSummary?: string;
  lastUiEventIds?: string[];
}) => {
  const filtered: Record<string, unknown> = {
    agentState: payload.agentState,
    marketSnapshot: payload.marketSnapshot,
  };
  if (typeof payload.lastAnalysisSummary === "string") {
    filtered.lastAnalysisSummary = payload.lastAnalysisSummary;
  }
  if (Array.isArray(payload.lastUiEventIds) && payload.lastUiEventIds.length) {
    filtered.lastUiEventIds = payload.lastUiEventIds;
  }
  return `Suggestion context:\n${JSON.stringify(filtered, null, 2)}`;
};

export const parseSuggestionResponsePayload = (response: unknown): unknown => {
  if (!response || typeof response !== "object") return null;
  const outputItems = Array.isArray((response as any).output) ? (response as any).output : [];
  const textParts: string[] = [];
  let parsed: unknown = null;
  for (const item of outputItems) {
    if (!item || typeof item !== "object") continue;
    if ((item as any).type !== "message" || !Array.isArray((item as any).content)) continue;
    for (const part of ((item as any).content as any[])) {
      const partType = typeof part?.type === "string" ? part.type : null;
      if (partType === "output_json") {
        parsed = (part as { json?: unknown }).json ?? null;
        if (parsed) break;
      }
      if (partType === "output_text" && typeof (part as { text?: unknown }).text === "string") {
        textParts.push((part as { text: string }).text);
      }
    }
    if (parsed) break;
  }
  if (parsed) {
    return parsed;
  }
  const joined = textParts.join("");
  if (joined) {
    try {
      return JSON.parse(joined);
    } catch {
      return null;
    }
  }
  const outputText = typeof (response as any).output_text === "string" ? (response as any).output_text : "";
  if (outputText) {
    try {
      return JSON.parse(outputText);
    } catch {
      return null;
    }
  }
  return null;
};
