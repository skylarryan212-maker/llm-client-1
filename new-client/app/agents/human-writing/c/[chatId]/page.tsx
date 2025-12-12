"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PageProps {
  params: { chatId: string };
}

type MessageKind = "text" | "cta";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind?: MessageKind;
  status?: "pending" | "done";
  draftText?: string;
}

function ChatInner({ params }: PageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prompt = searchParams.get("prompt")?.trim() || "";

  const [messages, setMessages] = useState<Message[]>([]);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isHumanizing, setIsHumanizing] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;

    if (prompt) {
      void startDraftFlow(prompt);
    } else {
      setMessages([
        {
          id: "init-assistant",
          role: "assistant",
          content: "Tell me what to write. I'll draft it and, once you approve, I'll run the humanizer.",
        },
      ]);
    }

    setInitialized(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, initialized]);

  const handleSubmit = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isDrafting || isHumanizing) return;
    void startDraftFlow(trimmed);
  };

  const shouldOfferHumanizer = (text: string) => {
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length < 6) return false;
    if (trimmed.length < 40) return false;
    return true;
  };

  const startDraftFlow = async (userText: string) => {
    const userId = `u-${Date.now()}`;
    const draftMsgId = `draft-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: userText },
      {
        id: draftMsgId,
        role: "assistant",
        content: "Drafting with the model...",
      },
    ]);

    setIsDrafting(true);
    let draft = "";
    try {
      const response = await fetch("/api/human-writing/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userText }),
      });

      if (!response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const data = await response.json();
        throw new Error(data?.error || "draft_failed");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) {
        throw new Error("No draft stream available");
      }

      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim().length > 0);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.error) throw new Error(obj.error);
            if (obj.token) {
              draft += obj.token;
              const currentDraft = draft;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === draftMsgId ? { ...msg, content: currentDraft } : msg
                )
              );
            }
            if (obj.done) {
              done = true;
            }
          } catch (err) {
            // Skip malformed lines but log for visibility
            console.warn("[draft-stream] failed to parse line", line);
          }
        }
      }

      if (!draft.trim()) {
        throw new Error("Draft stream returned no content");
      }

      const offerHumanizer = shouldOfferHumanizer(draft);
      setMessages((prev) => {
        const updated = prev.map((msg) =>
          msg.id === draftMsgId ? { ...msg, content: draft } : msg
        );
        if (!offerHumanizer) return updated;
        return [
          ...updated,
          {
            id: `cta-${Date.now()}`,
            role: "assistant",
            content: "Draft ready. Want me to humanize it now? (no detector or loop yet)",
            kind: "cta",
            draftText: draft,
            status: "pending",
          },
        ];
      });
    } catch (error: any) {
      const message = error?.message || "Unable to draft right now.";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === draftMsgId
            ? { ...msg, content: `Drafting failed: ${message}` }
            : msg
        )
      );
    } finally {
      setIsDrafting(false);
    }
  };

  const handleRunHumanizer = async (draftText: string, actionId: string) => {
    if (!draftText || isHumanizing) return;

    const runId = `humanize-${Date.now()}`;
    setIsHumanizing(true);
    setActiveActionId(actionId);
    setMessages((prev) => [
      ...prev,
      { id: runId, role: "assistant", content: "Running Rephrasy Humanizer..." },
    ]);

    try {
      const response = await fetch("/api/human-writing/humanize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: draftText,
          model: "undetectable",
          language: "auto",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "humanizer_failed");
      }

      const output = (data?.output as string) || "Humanizer returned no output.";
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === actionId) {
            return { ...msg, status: "done" };
          }
          if (msg.id === runId) {
            return {
              ...msg,
              content: `**Humanized draft**\n\n${output}`,
            };
          }
          return msg;
        })
      );
    } catch (error: any) {
      const message = error?.message || "Humanizer failed.";
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === runId ? { ...msg, content: `Humanizer error: ${message}` } : msg
        )
      );
    } finally {
      setIsHumanizing(false);
      setActiveActionId(null);
    }
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
                {messages.map((msg) => {
                  if (msg.kind === "cta") {
                    return (
                      <PipelineActionMessage
                        key={msg.id}
                        content={msg.content}
                        status={msg.status}
                        disabled={isHumanizing || !msg.draftText}
                        isRunning={isHumanizing && activeActionId === msg.id}
                        onConfirm={() => msg.draftText && handleRunHumanizer(msg.draftText, msg.id)}
                      />
                    );
                  }

                  return (
                    <ChatMessage
                      key={msg.id}
                      role={msg.role}
                      content={msg.content}
                      showInsightChips={false}
                      showModelActions={false}
                      enableEntryAnimation={false}
                      suppressPreStreamAnimation
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>
      </main>

      <div className="bg-[#0f0d12] px-4 pb-4 pt-3 sm:px-6 lg:px-12">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer
            onSendMessage={handleSubmit}
            placeholder="Send a prompt, I'll draft, then ask before running the humanizer..."
            isStreaming={isDrafting || isHumanizing}
          />
        </div>
      </div>
    </div>
  );
}

function PipelineActionMessage({
  content,
  status,
  disabled,
  isRunning,
  onConfirm,
}: {
  content: string;
  status?: "pending" | "done";
  disabled?: boolean;
  isRunning?: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white/80 shadow-inner shadow-black/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Run the humanizer now?</p>
          <p className="text-xs text-white/60">
            {content || "No detector or loop yet - just humanize the draft and show it."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status === "done" ? (
            <span className="text-xs font-semibold text-emerald-300">Completed</span>
          ) : (
            <Button
              type="button"
              size="sm"
              className="bg-gradient-to-r from-amber-400 via-pink-500 to-rose-500 text-white shadow-lg shadow-rose-500/30 hover:shadow-rose-500/50"
              onClick={onConfirm}
              disabled={disabled}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running
                </>
              ) : (
                "Run humanizer"
              )}
            </Button>
          )}
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
