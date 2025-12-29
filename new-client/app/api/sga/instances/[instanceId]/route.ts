import { NextRequest, NextResponse } from "next/server";

import {
  deleteSgaInstance,
  renameSgaInstance,
  updateSgaAssuranceLevel,
  updateSgaAuthorityLevel,
  updateSgaBudgets,
  updateSgaConnections,
  updateSgaPolicy,
  updateSgaStatus,
} from "@/lib/data/sga";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { SgaAuthorityLevel, SgaConnection, SgaPolicy, SgaStatus } from "@/lib/types/sga";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    await requireUserIdServer();
    const { instanceId } = await params;
    const body = (await request.json()) as {
      status?: SgaStatus;
      name?: string;
      assuranceLevel?: number;
      authorityLevel?: number;
      dailyTimeBudgetHours?: number | null;
      dailyCostBudgetUsd?: number | null;
      policy?: SgaPolicy;
      connections?: SgaConnection[];
    };

    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }

    const hasStatus = typeof body?.status === "string";
    const hasName = typeof body?.name === "string";
    const hasAssurance = typeof body?.assuranceLevel === "number";
    const hasAuthority = typeof body?.authorityLevel === "number";
    const hasBudgets =
      typeof body?.dailyTimeBudgetHours === "number" ||
      typeof body?.dailyCostBudgetUsd === "number" ||
      body?.dailyTimeBudgetHours === null ||
      body?.dailyCostBudgetUsd === null;
    const hasPolicy = !!body?.policy;
    const hasConnections = Array.isArray(body?.connections);

    if (!hasStatus && !hasName && !hasAssurance && !hasAuthority && !hasBudgets && !hasPolicy && !hasConnections) {
      return NextResponse.json({ error: "Missing updates" }, { status: 400 });
    }

    if (hasStatus && body.status) {
      await updateSgaStatus(instanceId, body.status as SgaStatus);
    }
    if (hasName && body.name) {
      await renameSgaInstance(instanceId, body.name);
    }
    if (hasAssurance) {
      const value = body.assuranceLevel;
      if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
        return NextResponse.json({ error: "Invalid assurance level" }, { status: 400 });
      }
      await updateSgaAssuranceLevel(instanceId, value);
    }
    if (hasAuthority) {
      const value = body.authorityLevel;
      if (value !== 0 && value !== 1 && value !== 2 && value !== 3 && value !== 4) {
        return NextResponse.json({ error: "Invalid authority level" }, { status: 400 });
      }
      await updateSgaAuthorityLevel(instanceId, value as SgaAuthorityLevel);
    }
    if (hasBudgets) {
      const dailyTimeBudgetHours =
        typeof body?.dailyTimeBudgetHours === "number" ? body.dailyTimeBudgetHours : null;
      const dailyCostBudgetUsd =
        typeof body?.dailyCostBudgetUsd === "number" ? body.dailyCostBudgetUsd : null;
      await updateSgaBudgets(instanceId, { dailyTimeBudgetHours, dailyCostBudgetUsd });
    }
    if (hasPolicy) {
      await updateSgaPolicy(instanceId, body.policy as SgaPolicy);
    }
    if (hasConnections) {
      await updateSgaConnections(instanceId, body.connections as SgaConnection[]);
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
