// app/projects/[projectId]/c/[chatId]/page.tsx
import ChatPageShell from "@/components/chat/chat-page-shell";

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

  const conversations = [
    {
      id: chatId,
      title: "Project conversation",
      timestamp: new Date().toISOString(),
      projectId,
    },
  ];

  const messages = [
    {
      id: "m1",
      role: "user" as const,
      content: "Project-specific chat goes here.",
      timestamp: new Date().toISOString(),
    },
  ];

  return (
    <main>
      <ChatPageShell
        conversations={conversations}
        activeConversationId={chatId}
        messages={messages}
        searchParams={resolvedSearchParams}
        projectId={projectId}
      />
    </main>
  );
}
