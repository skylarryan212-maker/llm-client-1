import { NextRequest, NextResponse } from "next/server";

import { updateSgaStatus } from "@/lib/data/sga";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { SgaStatus } from "@/lib/types/sga";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    await requireUserIdServer();
    const { instanceId } = await params;
    const body = (await request.json()) as { status?: SgaStatus };

    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }

    if (!body?.status) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await updateSgaStatus(instanceId, body.status);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update SGA instance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
