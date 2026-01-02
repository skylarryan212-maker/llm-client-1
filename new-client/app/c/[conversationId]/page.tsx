// app/c/[conversationId]/page.tsx
import { redirect } from "next/navigation";
import ChatPageShell from "@/components/chat/chat-page-shell";
import { getConversationById } from "@/lib/data/conversations";
import { getMessagesForConversationPage } from "@/lib/data/messages";
import type { Database } from "@/lib/supabase/types";
import { getCurrentUserIdentity } from "@/lib/supabase/user";

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
  const identity = await getCurrentUserIdentity();
  if (identity.isGuest) {
    redirect("/");
  }

  const { conversationId } = await params;
  const resolvedSearchParams = await searchParams;

  const conversation = await getConversationById(conversationId);

  const messagesPage = conversation
    ? await getMessagesForConversationPage(conversationId)
    : { messages: [], hasMore: false, oldestTimestamp: null };
  const messagesData = messagesPage.messages;

  const conversations = conversation
    ? [
        {
          id: conversation.id,
          title: conversation.title ?? "Untitled chat",
          timestamp: (conversation as any)?.last_activity ?? conversation.created_at ?? new Date().toISOString(),
          projectId: conversation.project_id ?? undefined,
        },
      ]
    : [
        {
          id: conversationId,
          title: "New chat",
          timestamp: new Date().toISOString(),
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
    <main className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-background">
      <ChatPageShell
        conversations={conversations}
        activeConversationId={conversationId}
        messages={messages}
        hasMoreMessages={messagesPage.hasMore}
        oldestMessageTimestamp={messagesPage.oldestTimestamp}
        searchParams={resolvedSearchParams}
        projectId={conversation?.project_id ?? undefined}
      />
    </main>
  );
}
