// app/page.tsx
import ChatPageShell from "@/components/chat/chat-page-shell";

export default function HomePage() {
  type ChatPageShellProps = Parameters<typeof ChatPageShell>[0];

  // Seed one demo conversation so it shows up in the sidebar
  const conversations: ChatPageShellProps["conversations"] = [
    {
      id: "1",
      title: "Demo conversation",
      timestamp: new Date().toISOString(),
    },
  ];

  const messages: ChatPageShellProps["messages"] = [
    {
      id: "m1",
      role: "user",
      content: "Hey, can you show the new UI?",
      timestamp: new Date().toISOString(),
    },
    {
      id: "m2",
      role: "assistant",
      content: "Here’s the static v0 chat layout wired up.",
      timestamp: new Date().toISOString(),
    },
  ];

  return (
    <main>
      <ChatPageShell
        conversations={conversations}
        activeConversationId={null}  // <- keeps `/` as “new chat”
        messages={messages}
        searchParams={{}}
      />
    </main>
  );
}
