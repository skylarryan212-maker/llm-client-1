"use server";

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function GET() {
  try {
    const userId = await requireUserIdServer();
    const supabase = await supabaseServer();

    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, created_at, metadata")
      .eq("user_id", userId)
      .eq("metadata->>agent", "human-writing")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      throw error;
    }

    return NextResponse.json({ tasks: data ?? [] });
  } catch (error: any) {
    console.error("[human-writing][tasks] error:", error);
    return NextResponse.json(
      { error: error?.message || "failed_to_fetch_tasks" },
      { status: 500 }
    );
  }
}
