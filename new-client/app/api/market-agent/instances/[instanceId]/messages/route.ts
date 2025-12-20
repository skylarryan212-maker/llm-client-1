import { NextRequest, NextResponse } from "next/server";

import { requireUserIdServer } from "@/lib/supabase/user";

function extractInstanceId(request: NextRequest, params?: { instanceId?: string }) {
  if (params?.instanceId) return params.instanceId;
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  return segments[segments.length - 2] || null;
}

export async function GET(request: NextRequest, context: { params?: { instanceId?: string } }) {
  try {
    await requireUserIdServer();
    const instanceId = extractInstanceId(request, context.params);
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }
    const { listMarketAgentMessages } = await import("@/lib/data/market-agent");
    const messages = await listMarketAgentMessages(instanceId, 200);
    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load chat messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params?: { instanceId?: string } }) {
  try {
    await requireUserIdServer();
    const instanceId = extractInstanceId(request, context.params);
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }
    const { insertMarketAgentMessage } = await import("@/lib/data/market-agent");
    const body = (await request.json()) as { role?: string; content?: string };
    const role = body?.role === "agent" ? "agent" : body?.role === "system" ? "system" : "user";
    const content = (body?.content ?? "").toString();
    const message = await insertMarketAgentMessage({ instanceId, role, content });
    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create chat message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
