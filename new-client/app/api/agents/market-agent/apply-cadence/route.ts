import { NextRequest, NextResponse } from "next/server";

import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import { updateMarketAgentUiEventStatus } from "@/lib/data/market-agent";

const ALLOWED_CADENCES = new Set([60, 120, 300, 600, 1800, 3600]);

type ApplyCadenceBody = {
  agentInstanceId?: string;
  eventId?: string;
  intervalSeconds?: number;
  mode?: "market_hours" | "always_on";
};

export async function POST(request: NextRequest) {
  try {
    const userId = await requireUserIdServer();
    const body = (await request.json()) as ApplyCadenceBody;
    const instanceId = body.agentInstanceId;
    const eventId = body.eventId;
    const intervalSeconds = body.intervalSeconds;
    if (
      !instanceId ||
      !eventId ||
      typeof intervalSeconds !== "number" ||
      !ALLOWED_CADENCES.has(intervalSeconds)
    ) {
      return NextResponse.json({ error: "Invalid cadence request" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    const { error } = await supabaseAny
      .from("market_agent_instances")
      .update({ cadence_seconds: intervalSeconds, updated_at: new Date().toISOString() })
      .eq("id", instanceId)
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to apply cadence: ${error.message}`);
    }

    await updateMarketAgentUiEventStatus(instanceId, eventId, "applied");

    return NextResponse.json({ cadenceSeconds: intervalSeconds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply cadence";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
