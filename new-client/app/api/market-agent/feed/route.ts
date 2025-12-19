import { NextRequest, NextResponse } from "next/server";

import { getMarketAgentFeed } from "@/lib/data/market-agent";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function GET(request: NextRequest) {
  try {
    await requireUserIdServer();
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const feed = await getMarketAgentFeed({
      instanceId: instanceId || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });

    return NextResponse.json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load market agent feed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
