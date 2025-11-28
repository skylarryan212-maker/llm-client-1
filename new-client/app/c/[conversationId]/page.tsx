// app/c/[conversationId]/page.tsx
import { notFound } from "next/navigation";
import ChatPageShell from "@/components/chat/chat-page-shell";
import { getConversationById } from "@/lib/data/conversations";
import { getMessagesForConversation } from "@/lib/data/messages";
import type { Database } from "@/lib/supabase/types";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

type PageParams = Promise<{ conversationId: string }>;
type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;

interface ConversationPageProps {
  params: PageParams;
  searchParams: PageSearchParams;
}

export default async function ConversationPage({
  params,
  searchParams,
}: ConversationPageProps) {
  const { conversationId } = await params;
  const resolvedSearchParams = await searchParams;

  const conversation = await getConversationById(conversationId);

  if (!conversation) {
    return notFound();
  }

  const messagesData = await getMessagesForConversation(conversationId);

  const conversations = [
    {
      id: conversation.id,
      title: conversation.title ?? "Untitled chat",
      timestamp: conversation.created_at ?? new Date().toISOString(),
      projectId: conversation.project_id ?? undefined,
    },
  ];

  const messages = messagesData.map((message: MessageRow) => ({
    id: message.id,
    role: (message.role ?? "assistant") as "user" | "assistant",
    content: message.content ?? "",
    timestamp: message.created_at ?? new Date().toISOString(),
    metadata: (message as any).metadata ?? null,
  }));

  return (
    <main>
      <ChatPageShell
        conversations={conversations}
        activeConversationId={conversationId}
        messages={messages}
        searchParams={resolvedSearchParams}
        projectId={conversation.project_id ?? undefined}
      />
    </main>
  );
}
