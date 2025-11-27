// app/page.tsx
import ChatPageShell from "@/components/chat/chat-page-shell";
import { getConversationsForUser } from "@/lib/data/conversations";

export default async function HomePage() {
  const conversationsData = await getConversationsForUser();

  const conversations = conversationsData.map((conversation) => ({
    id: conversation.id,
    title: conversation.title ?? "Untitled chat",
    timestamp: conversation.created_at ?? new Date().toISOString(),
    projectId: conversation.project_id ?? undefined,
  }));

  return (
    <main>
      <ChatPageShell
        conversations={conversations}
        activeConversationId={null}
        messages={[]}
        searchParams={{}}
      />
    </main>
  );
}
