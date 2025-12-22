// app/page.tsx
"use client";

import ChatPageShell from "@/components/chat/chat-page-shell";

export default function HomePage() {
  return (
    <main className="h-[100dvh] max-h-[100dvh] w-full min-w-0 overflow-hidden bg-background">
      <ChatPageShell
        conversations={[]}
        activeConversationId={null}
        messages={[]}
        searchParams={{}}
      />
    </main>
  );
}
