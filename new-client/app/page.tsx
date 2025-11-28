// app/page.tsx
import ChatPageShell from "@/components/chat/chat-page-shell";

export default async function HomePage() {
  return (
    <main>
      <ChatPageShell
        conversations={[]}
        activeConversationId={null}
        messages={[]}
        searchParams={{}}
      />
    </main>
  );
}
