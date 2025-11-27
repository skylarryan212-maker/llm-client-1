// app/c/[conversationId]/page.tsx
import { notFound } from "next/navigation";
import ChatPageShell from "@/components/chat/chat-page-shell";
import { getConversationById, getConversationsForUser } from "@/lib/data/conversations";
import { getMessagesForConversation } from "@/lib/data/messages";

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

  const [messagesData, conversationsData] = await Promise.all([
    getMessagesForConversation(conversationId),
    getConversationsForUser({ projectId: conversation.project_id }),
  ]);

  const conversations = conversationsData.map((item) => ({
    id: item.id,
    title: item.title ?? "Untitled chat",
    timestamp: item.created_at ?? new Date().toISOString(),
    projectId: item.project_id ?? undefined,
  }));

  const messages = messagesData.map((message) => ({
    id: message.id,
    role: (message.role ?? "assistant") as "user" | "assistant",
    content: message.content ?? "",
    timestamp: message.created_at ?? new Date().toISOString(),
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
