export const runtime = "nodejs";
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = "attachments";
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE config", needs: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] },
      { status: 500 }
    );
  }
  const admin = createClient(url, serviceKey);
  try {
    // Check if bucket exists
    const { data: list, error: listError } = await admin.storage.listBuckets();
    if (listError) {
      return NextResponse.json({ error: listError.message }, { status: 500 });
    }
    const existing = (list ?? []).find((b) => b.name === bucket);
    if (!existing) {
      const { error: createError } = await admin.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: 50 * 1024 * 1024, // 50MB
      });
      if (createError) {
        return NextResponse.json({ error: createError.message }, { status: 500 });
      }
    } else if (!(existing as any).public) {
      const { error: updateError } = await admin.storage.updateBucket(bucket, {
        public: true,
        fileSizeLimit: 50 * 1024 * 1024, // 50MB
      });
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    const { data: buckets } = await admin.storage.listBuckets();
    const target = (buckets ?? []).find((b) => b.name === bucket);
    return NextResponse.json({ ok: true, bucket, public: Boolean((target as any)?.public) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
