import { NextRequest, NextResponse } from "next/server";

import { loadSgaEvents, loadSgaInstance } from "@/lib/data/sga";
import { requireUserIdServer } from "@/lib/supabase/user";

function extractInstanceId(request: NextRequest, params?: { instanceId?: string }) {
  if (params?.instanceId) return params.instanceId;
  const segments = request.nextUrl.pathname.split("/").filter(Boolean);
  return segments[segments.length - 2] || null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ instanceId: string }> }
) {
  try {
    await requireUserIdServer();
    const params = await context.params;
    const instanceId = extractInstanceId(request, params);
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }

    const instance = await loadSgaInstance(instanceId);
    if (!instance) {
      return NextResponse.json({ error: "SGA instance not found" }, { status: 404 });
    }

    const events = await loadSgaEvents(instanceId, 200);
    return NextResponse.json({ events });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load SGA events";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
