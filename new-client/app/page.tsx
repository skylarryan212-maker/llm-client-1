// app/page.tsx
import dynamic from "next/dynamic";

// Disable SSR for the shell on the root page to avoid hydration mismatches when
// client-only state (e.g., media queries, localStorage-backed flags) diverges.
const ChatPageShell = dynamic(() => import("@/components/chat/chat-page-shell"), {
  ssr: false,
});

export default async function HomePage() {
  return (
    <main className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-background">
      <ChatPageShell
        conversations={[]}
        activeConversationId={null}
        messages={[]}
        searchParams={{}}
      />
    </main>
  );
}
