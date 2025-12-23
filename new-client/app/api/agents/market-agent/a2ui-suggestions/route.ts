import { NextRequest, NextResponse } from "next/server";
import { createOpenAIClient, getOpenAIRequestId } from "@/lib/openai/client";

import { listMarketAgentUiEventIds, upsertMarketAgentUiEvent } from "@/lib/data/market-agent";
import { requireUserIdServer } from "@/lib/supabase/user";
import { MarketSuggestionEvent } from "@/types/market-suggestion";
import {
  MAX_SUGGESTIONS,
  SUGGESTION_RESPONSE_SCHEMA,
  SUGGESTION_JSON_SYSTEM_PROMPT,
  extractSuggestionEvents,
  parseSuggestionResponsePayload,
} from "@/lib/market-agent/a2ui";

const MODEL_ID = "gpt-5-mini";
const SYSTEM_PROMPT = SUGGESTION_JSON_SYSTEM_PROMPT;

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

    const client = createOpenAIClient({ apiKey });
    const startedAt = Date.now();
    console.log("[a2ui] Calling OpenAI responses", { model: MODEL_ID });
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
          text: composeUserMessage(body, Array.from(dedupeSet)),
        },
      ],
    };

    const { data: response, response: rawResponse } = await client.responses
      .create(
        {
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
        },
        { timeout: 20000 }
      )
      .withResponse();
    console.log("[a2ui] OpenAI responses completed", { ms: Date.now() - startedAt });
    const requestId = getOpenAIRequestId(response, rawResponse);
    if (requestId) {
      console.log("[a2ui] OpenAI request id", { requestId });
    }

    if (response.error) {
      console.error("[a2ui] OpenAI response error", response.error);
      return NextResponse.json({ events: [] });
    }

    const parsed = parseSuggestionResponsePayload(response);
    if (!parsed) {
      console.warn("[a2ui] No structured output returned from model");
      return NextResponse.json({ events: [] });
    }
    const candidates = extractSuggestionEvents(parsed);
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
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "APIConnectionTimeoutError")
    ) {
      console.warn("[a2ui] OpenAI call timed out");
      return NextResponse.json({ events: [] }, { status: 504 });
    }
    console.error("[a2ui] Failed to generate suggestions", error);
    return NextResponse.json({ events: [] }, { status: 500 });
  }
}
