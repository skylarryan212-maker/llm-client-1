"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PageProps {
  params: { chatId: string };
}

function ChatInner({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt")?.trim() || "Write a short essay.";

  const [messages, setMessages] = useState(() => {
    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;
    return [
      { id: userId, role: "user" as const, content: prompt },
      { id: assistantId, role: "assistant" as const, content: "Coming soon — pipeline wiring in progress." },
    ];
  });
  const [composerText, setComposerText] = useState<string>("");

  const hasText = composerText.trim().length > 0;

  const handleSend = () => {
    const trimmed = composerText.trim();
    if (!trimmed) return;
    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: trimmed },
      { id: assistantId, role: "assistant", content: "Coming soon — pipeline wiring in progress." },
    ]);
    setComposerText("");
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
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-2xl px-4 py-3 shadow-sm ring-1 ring-white/5 ${
                  msg.role === "user" ? "bg-white/10 text-white" : "bg-white/5 text-white/90"
                }`}
              >
                <div className="mb-1 text-[11px] uppercase tracking-[0.25em] text-white/40">
                  {msg.role === "user" ? "You" : "Assistant"}
                </div>
                <p className="leading-relaxed">{msg.content}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 flex justify-center pb-4">
        <div className="pointer-events-auto relative w-full max-w-[960px] rounded-[20px] border border-white/15 bg-[#111118]/90 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
          <Textarea
            value={composerText}
            onChange={(e) => setComposerText(e.target.value)}
            placeholder="Write the next task..."
            className="min-h-[120px] resize-none border-0 bg-transparent text-white placeholder:text-white/50 shadow-none outline-none focus-visible:ring-0"
          />
          <div className="absolute bottom-4 right-4">
            <Button
              type="button"
              onClick={handleSend}
              className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow-lg transition hover:scale-[1.03] ${
                hasText
                  ? "bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 shadow-amber-600/40 hover:shadow-amber-600/60"
                  : "bg-white/10 text-white/60 shadow-black/30"
              }`}
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          </div>
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
