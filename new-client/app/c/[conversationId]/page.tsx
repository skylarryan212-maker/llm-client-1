// app/c/[conversationId]/page.tsx
import ChatPageShell from "@/components/chat/chat-page-shell";

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

  // Simple mock data to drive the UI
  const conversations = [
    {
      id: conversationId,
      title: "Demo conversation",
      modelName: "GPT-5.1",
      isStreaming: false,
      tags: [],
      messagesCount: 2,
      isPinned: false,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    },
  ];

  const messages = [
    {
      id: "m1",
      role: "user" as const,
      content: "Hey, can you show the new UI?",
      timestamp: new Date().toISOString(),
    },
    {
      id: "m2",
      role: "assistant" as const,
      content: "Here’s the static v0 chat layout wired up.",
      timestamp: new Date().toISOString(),
    },
  ];

  return (
    <main>
      <ChatPageShell
        conversations={conversations}
        activeConversationId={conversationId}
        messages={messages}
        searchParams={resolvedSearchParams}
      />
    </main>
  );
}
