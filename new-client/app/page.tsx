// app/page.tsx
"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import ChatPageShell from "@/components/chat/chat-page-shell";
import { LoginOverlay } from "@/components/auth/login-overlay";

export default function HomePage() {
  const searchParams = useSearchParams();
  const searchParamsObject = useMemo(() => {
    const entries = Array.from(searchParams.entries());
    return entries.reduce<Record<string, string | string[]>>((acc, [key, value]) => {
      if (acc[key]) {
        const existing = acc[key];
        acc[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});
  }, [searchParams]);
  const showLogin =
    searchParams.get("login") === "1" || searchParams.get("auth") === "1";

  return (
    <main className="h-[100dvh] max-h-[100dvh] w-full min-w-0 overflow-hidden bg-background">
      <ChatPageShell
        conversations={[]}
        activeConversationId={null}
        messages={[]}
        searchParams={searchParamsObject}
      />
      {showLogin ? <LoginOverlay /> : null}
    </main>
  );
}
