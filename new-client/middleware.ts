import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { nextUrl } = request;
  if (nextUrl.pathname === "/" && nextUrl.searchParams.has("code")) {
    const callbackUrl = nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    return NextResponse.redirect(callbackUrl);
  }
  return NextResponse.next();
}
