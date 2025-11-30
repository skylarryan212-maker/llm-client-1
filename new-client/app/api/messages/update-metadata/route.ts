import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { messageId, metadata } = await request.json();

    if (!messageId || !metadata) {
      return NextResponse.json(
        { error: "messageId and metadata are required" },
        { status: 400 }
      );
    }

    const supabase = await supabaseServer();

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
