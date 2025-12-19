import { NextRequest, NextResponse } from "next/server";

import {
  deleteMarketAgentInstance,
  getMarketAgentInstance,
  updateMarketAgentStatus,
} from "@/lib/data/market-agent";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    await requireUserIdServer();
    const { instanceId } = await params;
    const instance = await getMarketAgentInstance(instanceId);
    if (!instance) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ instance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load market agent instance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    await requireUserIdServer();
    const { instanceId } = await params;
    const body = (await request.json()) as { status?: "running" | "paused" };
    const status = body?.status === "paused" ? "paused" : body?.status === "running" ? "running" : null;
    if (!status) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    await updateMarketAgentStatus(instanceId, status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update market agent instance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    await requireUserIdServer();
    const { instanceId } = await params;
    await deleteMarketAgentInstance(instanceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete market agent instance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
