import { NextResponse } from "next/server";
import { supabaseServerAdmin } from "@/lib/supabase/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const email = (body?.email ?? "").toString().trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const admin = await supabaseServerAdmin();

    // Try admin listUsers; fall back to searching users table if necessary
    try {
      // @ts-ignore - admin SDK typings may differ; we only need to detect existence
      const listRes = await (admin.auth.admin as any).listUsers?.();
      if (listRes && Array.isArray(listRes.users)) {
        const found = listRes.users.some((u: any) => (u.email ?? "").toString().toLowerCase() === email);
        return NextResponse.json({ exists: found });
      }
    } catch (err) {
      // ignore and try alternative
    }

    // Alternative: attempt to query via SQL on auth.users (service role should allow this)
    try {
      const sql = `select id, email from auth.users where lower(email) = $1 limit 1`;
      const { data, error } = await admin.rpc("exec_sql", { sql });
      // If RPC not available, fall through to unknown
      if (error) {
        // fallthrough
      } else if (Array.isArray(data) && data.length) {
        return NextResponse.json({ exists: true });
      }
    } catch (err) {
      // ignore
    }

    // As a last resort, report not found (caller can still send OTP which will create account)
    return NextResponse.json({ exists: false });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
