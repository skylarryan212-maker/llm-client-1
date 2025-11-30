import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";

export async function POST(request: Request) {
  try {
    const { messageId, metadata } = await request.json() as { messageId: string; metadata: Json };

    if (!messageId || !metadata) {
      return NextResponse.json(
        { error: "messageId and metadata are required" },
        { status: 400 }
      );
    }

    const supabase = await supabaseServer();

    // @ts-ignore - Supabase type inference issue with metadata updates
    const { error } = await supabase
      .from("messages")
      .update({ metadata })
      .eq("id", messageId);

    if (error) {
      console.error("Failed to update message metadata:", error);
      return NextResponse.json(
        { error: "Failed to update metadata" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error in update-metadata endpoint:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
