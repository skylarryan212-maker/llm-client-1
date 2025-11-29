export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Restrict readable roots to the workspace folder only
const WORKSPACE_ROOT = path.resolve(process.cwd());
const MAX_BYTES = 200 * 1024; // 200KB safety limit

function isPathSafe(requestedPath: string) {
  const resolved = path.resolve(WORKSPACE_ROOT, requestedPath);
  return resolved.startsWith(WORKSPACE_ROOT + path.sep);
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { filePath?: string };
    const { filePath } = body;
    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json({ error: "filePath is required" }, { status: 400 });
    }
    if (!isPathSafe(filePath)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }
    const absPath = path.resolve(WORKSPACE_ROOT, filePath);
    const stat = await fs.stat(absPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    if (stat.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large", size: stat.size, max: MAX_BYTES }, { status: 413 });
    }
    const content = await fs.readFile(absPath, "utf8");
    return NextResponse.json({ path: filePath, bytes: Buffer.byteLength(content, "utf8"), content });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Internal error", details: message }, { status: 500 });
  }
}
