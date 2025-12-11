"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

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
    { id: `a-${Date.now()}`, role: "assistant", content: "Coming soon - pipeline wiring in progress." },
  ]);
  const [composerText, setComposerText] = useState("");

  const handleSubmit = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed) return;
    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: trimmed },
      { id: assistantId, role: "assistant", content: "Coming soon - pipeline wiring in progress." },
    ]);
  };

  const handleSendClick = () => {
    handleSubmit(composerText);
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
        <ScrollArea className="h-full">
          <div className="py-4">
            <div className="w-full px-4 sm:px-6 lg:px-12">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                {messages.map((msg) =>
                  msg.role === "assistant" ? (
                    <div key={msg.id} className="px-1">
                      <p className="text-sm leading-relaxed text-white/80">{msg.content}</p>
                    </div>
                  ) : (
                    <div
                      key={msg.id}
                      className="max-w-full rounded-2xl border border-white/10 bg-gradient-to-r from-[#1c1a22] via-[#1f1c27] to-[#1a1721] px-4 py-3 text-white shadow-lg shadow-black/30"
                    >
                      <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-white/45">You</div>
                      <p className="leading-relaxed text-white">{msg.content}</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </main>

      <div className="bg-[#0f0d12] px-4 pb-4 pt-3 sm:px-6 lg:px-12">
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-3xl border border-white/10 bg-[#111018]/90 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.55)] backdrop-blur-lg">
            <div className="flex items-end gap-3">
              <textarea
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder="Message the Human Writing Agent..."
                className="min-h-[60px] max-h-[240px] flex-1 resize-none border-0 bg-transparent text-base text-white placeholder:text-white/50 outline-none focus-visible:ring-0"
              />
              <Button
                type="button"
                onClick={handleSendClick}
                disabled={!composerText.trim()}
                className={`flex h-11 w-11 items-center justify-center rounded-full text-white transition ${
                  composerText.trim()
                    ? "bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 shadow-lg shadow-amber-600/40 hover:shadow-amber-600/60"
                    : "bg-white/10 text-white/50 shadow-none"
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M3.4 20.6 21 12 3.4 3.4l-.9 6.7 9 1.9-9 1.9.9 6.7Z" />
                </svg>
              </Button>
            </div>
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
