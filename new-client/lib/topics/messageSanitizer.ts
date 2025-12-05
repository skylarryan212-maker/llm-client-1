import type { Database } from "@/lib/supabase/types";

type MessageLike = Pick<
  Database["public"]["Tables"]["messages"]["Row"],
  "role" | "content" | "metadata"
>;

export function sanitizeTopicMessageContent(message: MessageLike): string {
  let content = message.content ?? "";
  if (message.role === "user") {
    const metadata = message.metadata as Record<string, unknown> | null | undefined;
    if (metadata && Array.isArray((metadata as { files?: unknown[] }).files)) {
      const attachmentPattern = /\n\nAttachment: [^\n]+ \([^)]+\)(?:\n|$)/g;
      content = content.replace(attachmentPattern, "").trim();
      if (content && !content.includes("[Files attached]")) {
        content = `${content} [Files attached]`;
      }
    }
  }
  return content;
}

