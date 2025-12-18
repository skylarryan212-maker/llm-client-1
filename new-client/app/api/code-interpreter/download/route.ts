export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return "download";
  return trimmed.replace(/[\\\/:*?"<>|]+/g, "_");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const messageId = url.searchParams.get("messageId") || "";
  const containerId = url.searchParams.get("containerId") || "";
  const fileId = url.searchParams.get("fileId") || "";

  if (!messageId || !containerId || !fileId) {
    return NextResponse.json({ error: "messageId, containerId, and fileId are required" }, { status: 400 });
  }

  const userId = await getCurrentUserIdServer();
  if (!userId) {
    return NextResponse.json({ error: "User not authenticated" }, { status: 401 });
  }

  const supabase = await supabaseServer();
  const supabaseAny = supabase as any;

  const { data: msgRow, error: msgErr } = await supabaseAny
    .from("messages")
    .select("conversation_id, metadata")
    .eq("id", messageId)
    .maybeSingle();

  if (msgErr || !msgRow?.conversation_id) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const conversationId = msgRow.conversation_id as string;
  const { data: convRow, error: convErr } = await supabaseAny
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (convErr || !convRow) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const metadata = msgRow.metadata && typeof msgRow.metadata === "object" ? (msgRow.metadata as any) : {};
  const files = Array.isArray(metadata.generatedFiles) ? metadata.generatedFiles : [];
  const match = files.find(
    (f: any) =>
      f &&
      typeof f.containerId === "string" &&
      typeof f.fileId === "string" &&
      f.containerId === containerId &&
      f.fileId === fileId
  );

  if (!match) {
    return NextResponse.json({ error: "File not found on message" }, { status: 404 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const upstream = await fetch(
    `https://api.openai.com/v1/containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(fileId)}/content`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  if (!upstream.ok) {
    const details = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "Failed to retrieve file", status: upstream.status, details },
      { status: 502 }
    );
  }

  const filename = sanitizeFilename(String(match.filename || "download"));
  const contentType = upstream.headers.get("content-type") || "application/octet-stream";

  return new Response(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

