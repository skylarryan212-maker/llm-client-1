import { NextResponse } from "next/server";
import { getFullUserPersonalization } from "@/lib/data/personalization";

export async function GET() {
  try {
    const prefs = await getFullUserPersonalization();
    return NextResponse.json({ success: true, data: prefs });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: String(error), data: null }, { status: 200 });
  }
}
