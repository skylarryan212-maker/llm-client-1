import { NextRequest, NextResponse } from "next/server";

import { getMarketAgentInstance, updateMarketAgentUiEventStatus } from "@/lib/data/market-agent";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

const WATCHLIST_LIMIT = 25;
const TICKER_PATTERN = /^[A-Z0-9.\-]{1,6}$/;

type ApplyWatchlistBody = {
  agentInstanceId?: string;
  eventId?: string;
  tickers?: string[];
  action?: "add" | "remove";
};

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserIdServer();
    const body = (await request.json()) as ApplyWatchlistBody;
    const instanceId = body.agentInstanceId;
    const eventId = body.eventId;
    if (!instanceId || !eventId) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (body.action && body.action !== "add") {
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    }
    const instance = await getMarketAgentInstance(instanceId, userId);
    if (!instance) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const requestedTickers =
      Array.isArray(body.tickers) && body.tickers.length
        ? Array.from(
            new Set(
              body.tickers
                .map((ticker) => (typeof ticker === "string" ? ticker.trim().toUpperCase() : ""))
                .filter((ticker) => ticker && TICKER_PATTERN.test(ticker))
            )
          )
        : [];

    if (!requestedTickers.length) {
      await updateMarketAgentUiEventStatus(instanceId, eventId, "applied");
      return NextResponse.json({ watchlist: instance.watchlist });
    }

    const existing = Array.isArray(instance.watchlist) ? instance.watchlist : [];
    const existingSet = new Set(existing.map((symbol) => symbol.toUpperCase()));
    const newSymbols = requestedTickers.filter((symbol) => !existingSet.has(symbol));
    const updatedList = [...existing, ...newSymbols];
    if (updatedList.length > WATCHLIST_LIMIT) {
      return NextResponse.json({ error: `Watchlist cannot exceed ${WATCHLIST_LIMIT} symbols.` }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;

    if (newSymbols.length) {
      const { error: insertError } = await supabaseAny
        .from("market_agent_watchlist_items")
        .insert(newSymbols.map((symbol) => ({ instance_id: instanceId, symbol })));
      if (insertError) {
        throw new Error(`Failed to update watchlist: ${insertError.message}`);
      }
    }

    const { error: touchError } = await supabaseAny
      .from("market_agent_instances")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", instanceId)
      .eq("user_id", userId);
    if (touchError) {
      throw new Error(`Failed to touch agent: ${touchError.message}`);
    }

    await updateMarketAgentUiEventStatus(instanceId, eventId, "applied");

    return NextResponse.json({ watchlist: updatedList });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
