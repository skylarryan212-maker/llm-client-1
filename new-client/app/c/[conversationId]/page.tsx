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

  const now = new Date().toISOString();

  const conversations = [
    {
      id: conversationId,
      title: "Demo conversation",
      modelName: "GPT-5.1",
      isStreaming: false,
      tags: [],
      messagesCount: 2,
      isPinned: false,
      createdAt: now,
      lastUpdated: now,
      timestamp: now,
    },
  ];

  const messages = [
    {
      id: "m1",
      role: "user" as const,
      content: "Hey, can you show the new UI?",
      timestamp: now,
    },
    {
      id: "m2",
      role: "assistant" as const,
      content: "Here’s the static v0 chat layout wired up.",
      timestamp: now,
    },
  ];

  const activeConversationId = conversations[0]?.id ?? conversationId;

  return (
    <main className="h-screen flex bg-background">
      <ChatPageShell
        conversations={conversations}
        activeConversationId={activeConversationId}
        messages={messages}
        searchParams={resolvedSearchParams}
      />
    </main>
  );
}
