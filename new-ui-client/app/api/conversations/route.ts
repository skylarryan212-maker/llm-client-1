export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { TEST_USER_ID } from "@/lib/appConfig";
import {
  normalizeConversationMeta,
  type ConversationMeta,
} from "@/lib/conversations";
import { getServerSupabaseClient } from "@/lib/serverSupabase";

export async function GET() {
  try {
    const supabase = getServerSupabaseClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("id, title, project_id, created_at, metadata")
      .eq("user_id", TEST_USER_ID)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[CONVERSATIONS_API] Failed to load conversations", error);
      return NextResponse.json(
        { error: "Unable to load conversations" },
        { status: 500 }
      );
    }

    const rows = Array.isArray(data) ? data : [];
    const normalized = rows
      .map((row) => normalizeConversationMeta(row))
      .filter((row): row is ConversationMeta => Boolean(row));

    return NextResponse.json({ conversations: normalized });
  } catch (error) {
    console.error("[CONVERSATIONS_API] Unexpected error", error);
    return NextResponse.json(
      { error: "Unable to load conversations" },
      { status: 500 }
    );
  }
}
