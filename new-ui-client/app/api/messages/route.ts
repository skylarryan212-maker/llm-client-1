export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getServerSupabaseClient } from "@/lib/serverSupabase";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversationId")?.trim();

  if (!conversationId) {
    return NextResponse.json(
      { error: "Missing conversationId" },
      { status: 400 }
    );
  }

  try {
    const supabase = getServerSupabaseClient();
    const { data, error } = await supabase
      .from("messages")
      .select("id, role, content, created_at, metadata")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Messages API query error", error);
      return NextResponse.json(
        { error: "Unable to load conversation messages" },
        { status: 500 }
      );
    }

    return NextResponse.json({ messages: data ?? [] });
  } catch (error) {
    console.error("Messages API error", error);
    return NextResponse.json(
      { error: "Unable to load conversation messages" },
      { status: 500 }
    );
  }
}
