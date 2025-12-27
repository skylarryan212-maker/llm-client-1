import { NextRequest, NextResponse } from "next/server";

import { insertSgaMessage, listSgaMessages, loadSgaInstance } from "@/lib/data/sga";
import { requireUserIdServer } from "@/lib/supabase/user";

const MODEL_ID = "gpt-5-nano";
const DEFAULT_GREETING = "Standing by for governance directives and timeline updates.";

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

    let messages = await listSgaMessages(instanceId, 200);
    if (messages.length === 0) {
      const greeting = await insertSgaMessage({
        instanceId,
        role: "agent",
        content: DEFAULT_GREETING,
        modelUsed: MODEL_ID,
        resolvedFamily: MODEL_ID,
      });
      messages = [greeting];
    }

    return NextResponse.json({ messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load SGA chat messages";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
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

    const body = (await request.json()) as { role?: string; content?: string };
    const role =
      body?.role === "agent" || body?.role === "assistant"
        ? "agent"
        : body?.role === "system"
          ? "system"
          : "user";
    const content = (body?.content ?? "").toString();

    const message = await insertSgaMessage({
      instanceId,
      role,
      content,
      modelUsed: role === "user" ? null : MODEL_ID,
      resolvedFamily: role === "user" ? null : MODEL_ID,
    });

    return NextResponse.json({ message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create SGA chat message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
