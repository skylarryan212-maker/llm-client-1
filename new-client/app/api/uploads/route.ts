export const runtime = "nodejs";
export const maxDuration = 60; // Allow time for large file uploads

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Missing Supabase config" },
      { status: 500 }
    );
  }
  const admin = createClient(url, serviceKey);
  const form = await req.formData();
  const bucket = (form.get("bucket") as string) || "attachments";
  const file = form.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const folder = new Date().toISOString().slice(0, 10);
  const clean = safeFileName(file.name || "file");
  const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}-${clean}`;

  // Ensure bucket exists
  try {
    const { data: buckets } = await admin.storage.listBuckets();
    const exists = (buckets ?? []).some((b) => b.name === bucket);
    if (!exists) {
      await admin.storage.createBucket(bucket, { public: true, fileSizeLimit: 50 * 1024 * 1024 });
    }
  } catch {}

  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const { error } = await admin.storage.from(bucket).upload(key, bytes, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: pub } = admin.storage.from(bucket).getPublicUrl(key);
  return NextResponse.json({
    name: file.name,
    path: key,
    url: pub?.publicUrl ?? null,
    mime: file.type || null,
  });
}
