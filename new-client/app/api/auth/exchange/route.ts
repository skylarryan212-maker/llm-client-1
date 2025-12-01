import { NextResponse } from "next/server";
import { SUPABASE_PKCE_VERIFIER_KEY } from "@/lib/supabase/constants";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function POST(req: Request) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: "Missing Supabase configuration" }, { status: 500 });
    }

    const body = await req.json();
    const code = body?.code;
    let code_verifier = body?.code_verifier;

    // If code_verifier not provided in JSON body, attempt to read it from
    // the Cookie header (we persist it on the client before redirect).
    if (!code_verifier) {
      const cookieHeader = req.headers.get("cookie") || "";
      const pkceKey = SUPABASE_PKCE_VERIFIER_KEY;
      const cookies = cookieHeader.split(";").map((c) => c.trim());
      for (const c of cookies) {
        if (!c) continue;
        const [k, v] = c.split("=");
        if (decodeURIComponent(k) === pkceKey) {
          code_verifier = decodeURIComponent(v ?? "");
          break;
        }
      }
    }

    if (!code || !code_verifier) {
      return NextResponse.json({ error: "code and code_verifier required" }, { status: 400 });
    }

    const tokenUrl = `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/token?grant_type=pkce`;

    const params = new URLSearchParams();
    // Many Supabase builds accept `auth_code` for PKCE exchange; include both
    // shapes server-side to maximize compatibility.
    params.set("auth_code", code);
    params.set("code", code);
    params.set("code_verifier", code_verifier);

    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        apikey: SUPABASE_ANON_KEY,
      },
      body: params.toString(),
    });

    const text = await res.text();
    let payload: any = null;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    return NextResponse.json(payload, { status: res.status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
