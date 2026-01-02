import { NextResponse } from "next/server";
import { getMessagesForConversationPage } from "@/lib/data/messages";

export async function POST(request: Request) {
  try {
    const { conversationId, before, limit } = (await request.json()) as {
      conversationId?: string;
      before?: string | null;
      limit?: number;
    };

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
    }

    const page = await getMessagesForConversationPage(conversationId, {
      before: before ?? null,
      limit: typeof limit === "number" && limit > 0 ? limit : undefined,
    });

    return NextResponse.json({
      messages: page.messages,
      hasMore: page.hasMore,
      oldestTimestamp: page.oldestTimestamp,
    });
  } catch (error) {
    console.error("Error in load-older endpoint:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
