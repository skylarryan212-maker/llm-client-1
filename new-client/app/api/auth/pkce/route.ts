import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SUPABASE_PKCE_VERIFIER_KEY } from "@/lib/supabase/constants";

export async function POST(request: Request) {
  try {
    const { pkce } = await request.json();
    if (typeof pkce !== "string" || pkce.length < 10) {
      return NextResponse.json({ error: "invalid_pkce" }, { status: 400 });
    }
    const cookieStore = cookies();
    try {
      cookieStore.set({
        name: SUPABASE_PKCE_VERIFIER_KEY,
        value: pkce,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 10,
      });
    } catch (e) {
      console.error("[pkce] failed to set cookie", e);
      return NextResponse.json({ error: "cookie_set_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
}

export async function GET() {
  const cookieStore = cookies();
  const pkceCookie = cookieStore.get(SUPABASE_PKCE_VERIFIER_KEY);
  if (!pkceCookie?.value) {
    return NextResponse.json({ pkce: null }, { status: 404 });
  }
  return NextResponse.json({ pkce: pkceCookie.value });
}
