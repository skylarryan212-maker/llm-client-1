import { NextRequest, NextResponse } from "next/server";

import { requireUserIdServer } from "@/lib/supabase/user";
import { updateMarketAgentUiEventStatus, MarketAgentUiEventStatus } from "@/lib/data/market-agent";

type UpdateStatusBody = {
  agentInstanceId?: string;
  eventId?: string;
  status?: MarketAgentUiEventStatus;
};

const ALLOWED_STATUSES: MarketAgentUiEventStatus[] = ["applied", "dismissed"];

export async function POST(request: NextRequest) {
  try {
    await requireUserIdServer();
    const body = (await request.json()) as UpdateStatusBody;
    const instanceId = body.agentInstanceId;
    const eventId = body.eventId;
    const status = body.status;
    if (!instanceId || !eventId || !status || !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    await updateMarketAgentUiEventStatus(instanceId, eventId, status);
    return NextResponse.json({ status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update suggestion status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
