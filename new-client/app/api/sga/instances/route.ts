import { NextRequest, NextResponse } from "next/server";

import { createSgaInstance, loadSgaInstances } from "@/lib/data/sga";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { SgaInstance } from "@/lib/types/sga";

export async function GET() {
  try {
    await requireUserIdServer();
    const instances = await loadSgaInstances();
    return NextResponse.json({ instances });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load SGA instances";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireUserIdServer();
    const body = (await request.json()) as Partial<SgaInstance>;

    const assuranceLevel =
      body?.assuranceLevel === 0 || body?.assuranceLevel === 1 || body?.assuranceLevel === 2 || body?.assuranceLevel === 3
        ? body.assuranceLevel
        : 1;

    const authorityLevel =
      body?.authorityLevel === 0 ||
      body?.authorityLevel === 1 ||
      body?.authorityLevel === 2 ||
      body?.authorityLevel === 3 ||
      body?.authorityLevel === 4
        ? body.authorityLevel
        : 2;

    const instance = await createSgaInstance({
      name: typeof body?.name === "string" ? body.name : "Self-Governing Agent",
      environmentLabel: typeof body?.environmentLabel === "string" ? body.environmentLabel : "Primary Ops",
      assuranceLevel,
      authorityLevel,
      dailyTimeBudgetHours: typeof body?.dailyTimeBudgetHours === "number" ? body.dailyTimeBudgetHours : null,
      dailyCostBudgetUsd: typeof body?.dailyCostBudgetUsd === "number" ? body.dailyCostBudgetUsd : null,
    });

    return NextResponse.json({ instance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create SGA instance";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
