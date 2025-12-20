import { NextResponse } from "next/server";

import { supabaseServer, supabaseServerAdmin } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import { getMarketAgentInstance } from "@/lib/data/market-agent";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const instanceId = url.searchParams.get("instanceId");

    const userId = await getCurrentUserIdServer();
    const admin = await supabaseServerAdmin().catch(() => null);
    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    const adminAny = admin as any;

    const instances = adminAny
      ? await adminAny.from("market_agent_instances").select("id, user_id, status").limit(5)
      : await supabaseAny.from("market_agent_instances").select("id, user_id, status").limit(5);

    let instanceById: any = null;
    let instanceByIdError: string | null = null;
    if (instanceId && adminAny) {
      const { data, error } = await adminAny
        .from("market_agent_instances")
        .select("*")
        .eq("id", instanceId)
        .maybeSingle();
      instanceById = data ?? null;
      instanceByIdError = error?.message ?? null;
    }

    let instanceViaHelper: any = null;
    let helperError: string | null = null;
    if (instanceId) {
      try {
        instanceViaHelper = await getMarketAgentInstance(instanceId);
      } catch (err) {
        helperError = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json({
      userId,
      hasAdmin: Boolean(admin),
      instances: instances?.data ?? [],
      errors: instances?.error ? instances.error.message : null,
      debugInstanceId: instanceId,
      instanceById,
      instanceByIdError,
      instanceViaHelper,
      helperError,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "debug error" },
      { status: 500 }
    );
  }
}
