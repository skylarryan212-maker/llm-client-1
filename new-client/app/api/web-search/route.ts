import { NextResponse } from "next/server";
import { runWebSearchPipeline } from "@/lib/search/fast-web-pipeline";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const result = await runWebSearchPipeline(prompt, payload?.options ?? {});
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[web-search] pipeline error", error);
    return NextResponse.json({ error: "Search pipeline failed" }, { status: 500 });
  }
}
