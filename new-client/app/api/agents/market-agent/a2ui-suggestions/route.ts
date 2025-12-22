import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

import { listMarketAgentUiEventIds, upsertMarketAgentUiEvent } from "@/lib/data/market-agent";
import { requireUserIdServer } from "@/lib/supabase/user";
import { MarketSuggestionEvent } from "@/types/market-suggestion";

const MODEL_ID = "gpt-5-mini";
const MAX_SUGGESTIONS = 5;

const SYSTEM_PROMPT = [
  "You generate UI-intent JSON for a suggestion card.",
  "You do NOT write UI; the application renders fixed templates.",
  "Only fill cadence interval + reason, optional watchlist tickers + reason (1-3 sentences each).",
  "Cadence interval must be 30..3600 seconds and the reason should be conservative.",
  "Watchlist suggestions should only surface when the user message or snapshot shows a missing relevant ticker.",
  "Return {\"events\": []} if no strong suggestion is justified.",
  "Do not repeat eventIds found in lastUiEventIds.",
  "Use the eventId format cadence:{intervalSeconds}:{YYYYMMDDHH}, watchlist:{sortedTickersJoinedByDash}:{YYYYMMDDHH}, or cadence-watchlist:{intervalSeconds}:{sortedTickersJoinedByDash}:{YYYYMMDDHH}, rounding the timestamp to the nearest hour.",
  "Do not add any extra fields beyond the defined schema.",
].join(" ");

const SUGGESTION_RESPONSE_SCHEMA = {
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
              intervalSeconds: { type: "number", minimum: 30, maximum: 3600 },
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
                maxItems: 50,
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
            required: ["cadence"],
            additionalProperties: false,
          },
          {
            type: "object",
            required: ["watchlist"],
            additionalProperties: false,
          },
        ],
      },
    },
  },
  required: ["events"],
  additionalProperties: false,
};

type AgentStatePayload = {
  status?: "running" | "paused";
  cadenceSeconds?: number;
  cadenceMode?: "market_hours" | "always_on";
  watchlistTickers?: string[];
  timezone?: string;
  lastRunAt?: string;
};

type SuggestionRequestBody = {
  agentInstanceId?: string;
  userMessage?: string;
  agentState?: AgentStatePayload;
  marketSnapshot?: Record<string, unknown> | null;
  lastAnalysisSummary?: string;
  lastUiEventIds?: string[];
};

const sanitizeCadence = (cadence: any) => {
  if (!cadence || typeof cadence !== "object") return null;
  const intervalSeconds =
    typeof cadence.intervalSeconds === "number" && Number.isFinite(cadence.intervalSeconds)
      ? Math.round(cadence.intervalSeconds)
      : NaN;
  if (!intervalSeconds || intervalSeconds < 30 || intervalSeconds > 3600) return null;
  const reason = typeof cadence.reason === "string" ? cadence.reason.trim() : "";
  if (!reason) return null;
  return { intervalSeconds, reason };
};

const tickerPattern = /^[A-Z0-9.\-]{1,6}$/;
const sanitizeWatchlist = (watchlist: any): { tickers: string[]; reason: string } | null => {
  if (!watchlist || typeof watchlist !== "object") return null;
  const rawTickers = Array.isArray(watchlist.tickers) ? (watchlist.tickers as unknown[]) : [];
  const normalizedTickers = rawTickers
    .map((ticker) => (typeof ticker === "string" ? ticker.trim().toUpperCase() : ""))
    .filter((ticker): ticker is string => Boolean(ticker) && tickerPattern.test(ticker));
  const tickers = Array.from(new Set<string>(normalizedTickers)).slice(0, 50);
  if (!tickers.length) return null;
  const reason = typeof watchlist.reason === "string" ? watchlist.reason.trim() : "";
  if (!reason) return null;
  return { tickers, reason };
};

const extractSuggestionEvents = (raw: unknown): MarketSuggestionEvent[] => {
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

const composeUserMessage = (body: SuggestionRequestBody, dedupeIds: string[]) => {
  const payload = {
    agentInstanceId: body.agentInstanceId,
    agentState: body.agentState,
    marketSnapshot: body.marketSnapshot ?? {},
    lastAnalysisSummary: body.lastAnalysisSummary ?? "",
    lastUiEventIds: dedupeIds,
  };
  return `User message:\n${body.userMessage ?? ""}\n\nAgent state + snapshot:\n${JSON.stringify(payload, null, 2)}`;
};

const clampInterval = (seconds: number) => {
  if (!Number.isFinite(seconds)) return null;
  const rounded = Math.round(seconds);
  if (rounded < 30 || rounded > 3600) return null;
  return rounded;
};

const parseCadenceFromMessage = (text?: string | null): number | null => {
  if (!text) return null;
  const match = text.match(/(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (match[2] ?? "").toLowerCase();
  let seconds = value;
  if (!unit || unit.startsWith("m")) {
    seconds = value * 60;
  }
  return clampInterval(seconds);
};

const formatEventHourStamp = () => {
  const now = new Date();
  if (now.getMinutes() >= 30) {
    now.setHours(now.getHours() + 1);
  }
  now.setMinutes(0, 0, 0);
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, "0");
  const d = `${now.getDate()}`.padStart(2, "0");
  const h = `${now.getHours()}`.padStart(2, "0");
  return `${y}${m}${d}${h}`;
};

const buildFallbackSuggestions = (
  body: SuggestionRequestBody,
  dedupeSet: Set<string>
): MarketSuggestionEvent[] => {
  const results: MarketSuggestionEvent[] = [];
  const interval = parseCadenceFromMessage(body.userMessage);
  if (interval) {
    const ts = formatEventHourStamp();
    const eventId = `cadence:${interval}:${ts}`;
    if (!dedupeSet.has(eventId)) {
      results.push({
        kind: "market_suggestion",
        eventId,
        cadence: {
          intervalSeconds: interval,
          reason: "User explicitly requested this cadence.",
        },
      });
    }
  }
  return results;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SuggestionRequestBody;
    console.log("[a2ui] Incoming request", {
      agentInstanceId: body?.agentInstanceId,
      hasAgentState: Boolean(body?.agentState),
      userMessageLength: body?.userMessage?.length ?? 0,
    });
    if (!body?.agentInstanceId) {
      return NextResponse.json({ events: [] });
    }
    if (!body.agentState) {
      return NextResponse.json({ events: [] });
    }

    const recentEventIds = await listMarketAgentUiEventIds(body.agentInstanceId, 50);
    const requestEventIds = Array.isArray(body.lastUiEventIds)
      ? body.lastUiEventIds
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .slice(-50)
      : [];
    const dedupeSet = new Set<string>([...recentEventIds, ...requestEventIds]);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[a2ui] Missing OpenAI API key");
      return NextResponse.json({ events: [] }, { status: 500 });
    }

    const client = new OpenAI({ apiKey });
    const startedAt = Date.now();
    console.log("[a2ui] Calling OpenAI responses", { model: MODEL_ID });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    const systemMessage = {
      id: "msg_a2ui_system",
      role: "system" as const,
      content: [{ type: "input_text" as const, text: SYSTEM_PROMPT }],
    };
    const userMessageInput = {
      id: "msg_a2ui_user",
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: composeUserMessage(body, requestEventIds),
        },
      ],
    };

    let response;
    try {
      response = await client.responses.create({
        model: MODEL_ID,
        input: [systemMessage, userMessageInput],
        text: {
          format: {
            type: "json_schema",
            name: "MarketSuggestionResponse",
            schema: SUGGESTION_RESPONSE_SCHEMA,
          },
        },
        store: false,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    console.log("[a2ui] OpenAI responses completed", { ms: Date.now() - startedAt });

    if (response.error) {
      console.error("[a2ui] OpenAI response error", response.error);
      return NextResponse.json({ events: [] });
    }

    const outputItems = Array.isArray(response.output) ? response.output : [];
    const textParts: string[] = [];
    for (const item of outputItems) {
      if (item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          textParts.push(part.text);
        }
      }
    }
    if (!textParts.length) {
      console.warn("[a2ui] No output_text returned from model");
      return NextResponse.json({ events: [] });
    }

    const joined = textParts.join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(joined);
    } catch (error) {
      console.warn("[a2ui] Failed to parse model output", { error, payload: joined });
      return NextResponse.json({ events: [] });
    }

    let candidates = extractSuggestionEvents(parsed);
    if (!candidates.length) {
      console.log("[a2ui] No model suggestions; applying fallback parsing from user message");
      const fallback = buildFallbackSuggestions(body, dedupeSet);
      candidates = fallback;
    }
    console.log("[a2ui] Parsed candidates", {
      count: candidates.length,
      eventIds: candidates.map((c) => c.eventId),
    });
    const insertedEvents: MarketSuggestionEvent[] = [];
    for (const candidate of candidates) {
      if (dedupeSet.has(candidate.eventId)) continue;
      if (insertedEvents.length >= MAX_SUGGESTIONS) break;
      await upsertMarketAgentUiEvent({
        instanceId: body.agentInstanceId,
        eventId: candidate.eventId,
        kind: candidate.kind,
        payload: candidate,
        status: "proposed",
      });
      dedupeSet.add(candidate.eventId);
      insertedEvents.push(candidate);
    }

    console.log("[a2ui] Returning events", { count: insertedEvents.length });
    return NextResponse.json({ events: insertedEvents });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[a2ui] OpenAI call timed out");
      return NextResponse.json({ events: [] }, { status: 504 });
    }
    console.error("[a2ui] Failed to generate suggestions", error);
    return NextResponse.json({ events: [] }, { status: 500 });
  }
}
