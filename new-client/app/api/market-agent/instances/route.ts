import { NextRequest, NextResponse } from "next/server";

import {
  createMarketAgentInstance,
  listMarketAgentInstances,
} from "@/lib/data/market-agent";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function GET() {
  try {
    await requireUserIdServer();
    const instances = await listMarketAgentInstances();
    return NextResponse.json({ instances });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load market agent instances";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireUserIdServer();
    const body = (await request.json()) as {
      label?: string;
      cadenceSeconds?: number;
      watchlist?: string[] | string | null;
      status?: "running" | "paused";
      config?: Record<string, unknown>;
    };

    const cadenceSeconds = typeof body?.cadenceSeconds === "number" ? body.cadenceSeconds : 300;
    const watchlistInput = body?.watchlist;
    const watchlist =
      Array.isArray(watchlistInput)
        ? watchlistInput.map((s) => String(s || "").trim()).filter(Boolean)
        : typeof watchlistInput === "string"
          ? watchlistInput
              .split(/[,\n]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];

    const instance = await createMarketAgentInstance({
      label: body?.label ?? "Market Agent",
      cadenceSeconds,
      watchlist,
      config: (body?.config as any) ?? {},
      status: body?.status === "paused" ? "paused" : "running",
    });

    return NextResponse.json({ instance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create market agent instance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
