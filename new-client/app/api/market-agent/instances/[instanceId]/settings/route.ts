import { NextRequest, NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

type ReportDepth = "short" | "standard" | "deep";

const WATCHLIST_LIMIT = 25;
const ALLOWED_CADENCES = new Set([60, 120, 300, 600, 1800, 3600]);
const ALLOWED_REPORT_DEPTH = new Set<ReportDepth>(["short", "standard", "deep"]);

type SettingsPayload =
  | { type: "watchlist"; watchlist: unknown }
  | { type: "schedule"; cadenceSeconds: number }
  | { type: "reportDepth"; reportDepth: ReportDepth };

function sanitizeWatchlistSymbols(value: unknown): { symbols?: string[]; error?: string } {
  if (!Array.isArray(value)) {
    return { error: "Watchlist must be an array of symbols" };
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));
  if (unique.length > WATCHLIST_LIMIT) {
    return { error: `A watchlist can contain at most ${WATCHLIST_LIMIT} symbols.` };
  }
  const invalidSymbol = unique.find((symbol) => !/^[A-Z0-9.\-]+$/.test(symbol));
  if (invalidSymbol) {
    return { error: `Ticker "${invalidSymbol}" contains invalid characters.` };
  }
  return { symbols: unique };
}

async function persistWatchlist(
  supabaseAny: any,
  userId: string,
  instanceId: string,
  symbols: string[]
) {
  const { error: deleteError } = await supabaseAny
    .from("market_agent_watchlist_items")
    .delete()
    .eq("instance_id", instanceId);
  if (deleteError) {
    throw new Error(`Failed to clear watchlist: ${deleteError.message}`);
  }

  if (symbols.length) {
    const { error: insertError } = await supabaseAny
      .from("market_agent_watchlist_items")
      .insert(symbols.map((symbol) => ({ instance_id: instanceId, symbol })));
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
    throw new Error(`Failed to touch market agent instance: ${touchError.message}`);
  }

  return symbols;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    const userId = await requireUserIdServer();
    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    const { instanceId } = await params;
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }

    const body = (await request.json()) as Partial<SettingsPayload>;
    if (!body?.type) {
      return NextResponse.json({ error: "Invalid update type" }, { status: 400 });
    }

    switch (body.type) {
      case "watchlist": {
        const { symbols, error } = sanitizeWatchlistSymbols(body.watchlist ?? []);
        if (error) {
          return NextResponse.json({ error }, { status: 400 });
        }
        const updated = await persistWatchlist(supabaseAny, userId, instanceId, symbols ?? []);
        return NextResponse.json({ watchlist: updated });
      }
      case "schedule": {
        if (typeof body.cadenceSeconds !== "number" || !ALLOWED_CADENCES.has(body.cadenceSeconds)) {
          return NextResponse.json({ error: "Invalid cadence" }, { status: 400 });
        }
        const { error } = await supabaseAny
          .from("market_agent_instances")
          .update({ cadence_seconds: body.cadenceSeconds, updated_at: new Date().toISOString() })
          .eq("id", instanceId)
          .eq("user_id", userId);
        if (error) {
          throw new Error(`Failed to update cadence: ${error.message}`);
        }
        return NextResponse.json({ cadenceSeconds: body.cadenceSeconds });
      }
      case "reportDepth": {
        if (!ALLOWED_REPORT_DEPTH.has(body.reportDepth)) {
          return NextResponse.json({ error: "Invalid report depth" }, { status: 400 });
        }
        const { error } = await supabaseAny
          .from("market_agent_instances")
          .update({ report_depth: body.reportDepth, updated_at: new Date().toISOString() })
          .eq("id", instanceId)
          .eq("user_id", userId);
        if (error) {
          throw new Error(`Failed to update report depth: ${error.message}`);
        }
        return NextResponse.json({ reportDepth: body.reportDepth });
      }
      default:
        return NextResponse.json({ error: "Unknown update type" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update market agent settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
