import { NextRequest, NextResponse } from "next/server";

import { ensureMarketAgentConversation } from "@/lib/data/market-agent";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function POST(request: NextRequest) {
  try {
    await requireUserIdServer();
    const body = (await request.json()) as { instanceId?: string };
    if (!body?.instanceId) {
      return NextResponse.json({ error: "instanceId is required" }, { status: 400 });
    }

    const conversation = await ensureMarketAgentConversation(body.instanceId);
    return NextResponse.json({ conversationId: conversation.id, conversation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create market agent conversation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
