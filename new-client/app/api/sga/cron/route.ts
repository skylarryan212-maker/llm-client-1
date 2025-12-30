import { NextResponse } from "next/server";

import { listSgaInstancesAdmin } from "@/lib/data/sga";
import { supabaseServerAdmin } from "@/lib/supabase/server";
import type { SgaInstance } from "@/lib/types/sga";

export const runtime = "nodejs";

const DEFAULT_MINUTES = 15;

type WaitingRun = {
  instance_id: string;
  created_at: string | null;
  updated_at: string | null;
};

function resolveBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return null;
}

function isActiveInstance(instance: SgaInstance) {
  if (instance.status === "paused" || instance.status === "idle" || instance.status === "error") {
    return false;
  }
  return true;
}

function getCadenceMinutes(instance: SgaInstance) {
  const min = instance.policy?.throttleRules?.minMinutesBetweenCyclesNormal;
  const parsed = Number(min);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_MINUTES;
}

export async function GET(request: Request) {
  const cronHeader = request.headers.get("x-vercel-cron");
  const authHeader = request.headers.get("authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const cronSecret = process.env.CRON_SECRET ?? process.env.SGA_CRON_SECRET;
  const authorized = cronSecret ? bearerToken === cronSecret : cronHeader === "1";

  if (!authorized) {
    console.warn("[sga-cron] unauthorized request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    console.error("[sga-cron] missing site URL");
    return NextResponse.json({ error: "Missing site URL" }, { status: 500 });
  }

  const instances = (await listSgaInstancesAdmin()).filter(isActiveInstance);
  if (instances.length === 0) {
    console.info("[sga-cron] no active instances");
    return NextResponse.json({ ok: true, scheduled: 0 });
  }

  const supabase = await supabaseServerAdmin();
  const supabaseAny = supabase as any;
  const instanceIds = instances.map((instance) => instance.id);
  const { data: waitingRuns } = await supabaseAny
    .from("governor_runs")
    .select("instance_id, created_at, updated_at")
    .eq("status", "waiting")
    .eq("current_phase", 0)
    .in("instance_id", instanceIds)
    .order("updated_at", { ascending: false });

  const latestWaiting = new Map<string, WaitingRun>();
  (waitingRuns as WaitingRun[] | null | undefined)?.forEach((row) => {
    if (!latestWaiting.has(row.instance_id)) {
      latestWaiting.set(row.instance_id, row);
    }
  });

  const now = Date.now();
  const dueInstances = instances.filter((instance) => {
    const cadenceMinutes = getCadenceMinutes(instance);
    const cadenceMs = cadenceMinutes * 60 * 1000;
    const waitRow = latestWaiting.get(instance.id);
    const lastMark = waitRow?.updated_at ?? waitRow?.created_at ?? instance.lastDecisionAt ?? null;
    if (!lastMark) {
      return false;
    }
    const lastMs = new Date(lastMark).getTime();
    if (Number.isNaN(lastMs)) return false;
    return now - lastMs >= cadenceMs;
  });

  console.info("[sga-cron] tick", {
    totalInstances: instances.length,
    dueInstances: dueInstances.length,
  });

  const results = await Promise.allSettled(
    dueInstances.map((instance) =>
      fetch(`${baseUrl}/api/sga/instances/${instance.id}/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cronSecret ? { "x-sga-cron": cronSecret } : {}),
        },
        body: JSON.stringify({ trigger: "schedule" }),
      })
    )
  );

  const scheduled = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    console.warn("[sga-cron] run dispatch failures", { failed });
  }
  return NextResponse.json({ ok: true, scheduled, attempted: dueInstances.length });
}
