import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_VALUE,
  AUTH_LOGIN_CODE,
} from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (code !== AUTH_LOGIN_CODE) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: AUTH_COOKIE_VALUE,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: AUTH_COOKIE_MAX_AGE,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Login API error", error);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
