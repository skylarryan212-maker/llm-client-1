// Lightweight proxy: forward guest requests to the main chat handler so guests run the same code path.
export const runtime = "nodejs";

import type { NextRequest } from "next/server";
// Import the main chat POST handler and re-export for guest access.
import { POST as mainChatPOST } from "../chat/route";

export async function POST(request: NextRequest) {
  // Forward the incoming request to the main chat handler.
  // This keeps behavior identical between guest and main chat and avoids divergence.
  return await mainChatPOST(request as any);
}
