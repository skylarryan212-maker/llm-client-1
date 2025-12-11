"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PageProps {
  params: { chatId: string };
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

function ChatInner({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt")?.trim() || "Write a short essay.";

  const [messages, setMessages] = useState<Message[]>([
    { id: `u-${Date.now()}`, role: "user", content: prompt },
    { id: `a-${Date.now()}`, role: "assistant", content: "Coming soon — pipeline wiring in progress." },
  ]);

  const handleSubmit = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: trimmed },
      { id: assistantId, role: "assistant", content: "Coming soon — pipeline wiring in progress." },
    ]);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0f0d12] text-foreground">
      <header className="flex h-[56px] items-center gap-3 border-b border-white/10 bg-black/60 px-4 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-white/80 hover:text-white"
          onClick={() => router.push("/agents/human-writing")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex flex-col">
          <p className="text-xs uppercase tracking-[0.25em] text-white/40">Human Writing Agent</p>
          <p className="text-sm text-white/80 truncate">Session: {params.chatId}</p>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <ScrollArea className="h-full px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-[960px] flex-col gap-4">
            {messages.map((msg) =>
              msg.role === "assistant" ? (
                <div key={msg.id} className="px-1">
                  <p className="text-sm leading-relaxed text-white/80">{msg.content}</p>
                </div>
              ) : (
                <ChatMessage
                  key={msg.id}
                  role="user"
                  content={msg.content}
                  showInsightChips={false}
                  enableEntryAnimation={false}
                  suppressPreStreamAnimation
                />
              )
            )}
          </div>
        </ScrollArea>
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-4">
        <div className="pointer-events-auto w-full max-w-[960px] px-4">
          <ChatComposer onSendMessage={handleSubmit} placeholder="Message the Human Writing Agent..." />
        </div>
      </div>
    </div>
  );
}

export default function HumanWritingChatPage(props: PageProps) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0f0d12]" />}>
      <ChatInner {...props} />
    </Suspense>
  );
}