// app/page.tsx
"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import ChatPageShell from "@/components/chat/chat-page-shell";
import { LoginOverlay } from "@/components/auth/login-overlay";
import { useLoginModal } from "@/lib/auth/login-context";

function HomeShell() {
  const searchParams = useSearchParams();
  const { isLoginModalOpen } = useLoginModal();
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
  const showLogin = isLoginModalOpen || searchParams.get("login") === "1" || searchParams.get("auth") === "1";

  return (
    <>
      <ChatPageShell
        conversations={[]}
        activeConversationId={null}
        messages={[]}
        searchParams={searchParamsObject}
      />
      {showLogin ? <LoginOverlay /> : null}
    </>
  );
}

export default function HomePage() {
  return (
    <main className="h-[100dvh] max-h-[100dvh] w-full min-w-0 overflow-hidden bg-background">
      <Suspense fallback={null}>
        <HomeShell />
      </Suspense>
    </main>
  );
}
