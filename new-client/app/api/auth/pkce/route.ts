import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SUPABASE_PKCE_VERIFIER_KEY } from "@/lib/supabase/constants";

export async function POST(request: Request) {
  try {
    const { pkce } = await request.json();
    if (typeof pkce !== "string" || pkce.length < 10) {
      return NextResponse.json({ error: "invalid_pkce" }, { status: 400 });
    }
    const maybeStore = cookies();
    const cookieStore =
      maybeStore && typeof (maybeStore as any).then === "function"
        ? await (maybeStore as Promise<ReturnType<typeof cookies>>)
        : (maybeStore as ReturnType<typeof cookies>);
    try {
      if (cookieStore && typeof (cookieStore as any).set === "function") {
        (cookieStore as any).set({
          name: SUPABASE_PKCE_VERIFIER_KEY,
          value: pkce,
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          maxAge: 60 * 10,
        });
      } else {
        throw new Error("cookieStore.set is not available in this context");
      }
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
  const maybeStore = cookies();
  const cookieStore =
    maybeStore && typeof (maybeStore as any).then === "function"
      ? await (maybeStore as Promise<ReturnType<typeof cookies>>)
      : (maybeStore as ReturnType<typeof cookies>);
  const pkceCookie = (cookieStore as any)?.get?.(SUPABASE_PKCE_VERIFIER_KEY);
  if (!pkceCookie?.value) {
    return NextResponse.json({ pkce: null }, { status: 404 });
  }
  return NextResponse.json({ pkce: pkceCookie.value });
}
