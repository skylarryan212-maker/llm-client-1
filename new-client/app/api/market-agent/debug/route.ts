import { NextResponse } from "next/server";

import { supabaseServer, supabaseServerAdmin } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await getCurrentUserIdServer();
    const admin = await supabaseServerAdmin().catch(() => null);
    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    const adminAny = admin as any;

    const instances = adminAny
      ? await adminAny.from("market_agent_instances").select("id, user_id").limit(5)
      : await supabaseAny.from("market_agent_instances").select("id, user_id").limit(5);

    return NextResponse.json({
      userId,
      hasAdmin: Boolean(admin),
      instances: instances?.data ?? [],
      errors: instances?.error ? instances.error.message : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "debug error" },
      { status: 500 }
    );
  }
}
