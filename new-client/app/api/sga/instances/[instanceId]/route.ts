import { NextRequest, NextResponse } from "next/server";

import { deleteSgaInstance, renameSgaInstance, updateSgaStatus } from "@/lib/data/sga";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { SgaStatus } from "@/lib/types/sga";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    await requireUserIdServer();
    const { instanceId } = await params;
    const body = (await request.json()) as { status?: SgaStatus; name?: string };

    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }

    if (!body?.status && typeof body?.name !== "string") {
      return NextResponse.json({ error: "Missing updates" }, { status: 400 });
    }

    if (body?.status) {
      await updateSgaStatus(instanceId, body.status);
    }
    if (typeof body?.name === "string") {
      await renameSgaInstance(instanceId, body.name);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update SGA instance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    await requireUserIdServer();
    const { instanceId } = await params;
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }
    await deleteSgaInstance(instanceId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete SGA instance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
