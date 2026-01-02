// app/projects/[projectId]/c/[chatId]/page.tsx
import { notFound } from "next/navigation";
import ChatPageShell from "@/components/chat/chat-page-shell";
import { getConversationById } from "@/lib/data/conversations";
import { getMessagesForConversationPage } from "@/lib/data/messages";

interface PageParams {
  projectId: string;
  chatId: string;
}

interface ConversationPageProps {
  params: Promise<PageParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ProjectChatPage({
  params,
  searchParams,
}: ConversationPageProps) {
  const { projectId, chatId } = await params;
  const resolvedSearchParams = await searchParams;

  const conversation = await getConversationById(chatId);

  if (!conversation || conversation.project_id !== projectId) {
    return notFound();
  }

  const messagesPage = await getMessagesForConversationPage(chatId);
  const messagesData = messagesPage.messages;

  const conversations = [
    {
      id: conversation.id,
      title: conversation.title ?? "Untitled chat",
      timestamp: (conversation as any)?.last_activity ?? conversation.created_at ?? new Date().toISOString(),
      projectId: conversation.project_id ?? undefined,
    },
  ];

  const messages = messagesData.map((message) => ({
    id: message.id,
    role: (message.role ?? "assistant") as "user" | "assistant",
    content: message.content ?? "",
    timestamp: message.created_at ?? new Date().toISOString(),
    metadata: (message as any).metadata ?? null,
  }));

  return (
    <main className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-background">
      <ChatPageShell
        conversations={conversations}
        activeConversationId={chatId}
        messages={messages}
        hasMoreMessages={messagesPage.hasMore}
        oldestMessageTimestamp={messagesPage.oldestTimestamp}
        searchParams={resolvedSearchParams}
        projectId={projectId}
      />
    </main>
  );
}
