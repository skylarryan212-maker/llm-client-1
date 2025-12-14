"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, Loader2 } from "lucide-react";

import { ChatComposer } from "@/components/chat-composer";
import { ChatMessage } from "@/components/chat-message";
import { Button } from "@/components/ui/button";
import supabaseBrowserClient from "@/lib/supabase/browser-client";

interface PageProps {
  params: { chatId: string };
}

type MessageKind = "text" | "cta" | "drafting";

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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<Message[]>([]);

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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleSubmit = (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || isDrafting || isHumanizing) return;
    setIsAutoScroll(true);
    void startDraftFlow(trimmed);
  };

  const startDraftFlow = async (userText: string) => {
    const priorMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    const userId = `u-${Date.now()}`;
    const draftMsgId = `draft-${Date.now()}`;

    setMessages((prev) => {
      const next: Message[] = [
        ...prev,
        { id: userId, role: "user", content: userText },
        {
          id: draftMsgId,
          role: "assistant",
          content: "Drafting with the model...",
          kind: "drafting",
        },
      ];
      messagesRef.current = next;
      return next;
    });

    setIsDrafting(true);
    let draft = "";
    let shouldShowCTA = false;
    try {
      const response = await fetch("/api/human-writing/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userText }),
      });

      if (!response.ok) {
        const data = response.headers.get("content-type")?.includes("application/json")
          ? await response.json()
          : null;
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
                  msg.id === draftMsgId ? { ...msg, content: currentDraft, kind: undefined } : msg
                )
              );
            }
            if (obj.decision) {
              if (typeof obj.decision.show === "boolean") {
                shouldShowCTA = obj.decision.show;
              }
            }
            if (obj.done) {
              done = true;
            }
          } catch (err) {
            console.warn("[draft-stream] failed to parse line", line);
          }
        }
      }

      if (!draft.trim()) {
        throw new Error("draft_empty");
      }

      setMessages((prev) => {
        const updated = prev.map((msg) =>
          msg.id === draftMsgId ? { ...msg, content: draft } : msg
        );
        const next =
          shouldShowCTA && !updated.some((m) => m.kind === "cta")
            ? [
                ...updated,
                {
                  id: `cta-${Date.now()}`,
                  role: "assistant",
                  content: "Draft ready. Want me to humanize it now? (no detector or loop yet)",
                  kind: "cta" as MessageKind,
                  draftText: draft,
                  status: "pending",
                } as Message,
              ]
            : updated;
        messagesRef.current = next;
        void syncTranscript(next);
        return next;
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
      void syncTranscript(messagesRef.current);
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
      messagesRef.current = messagesRef.current.map((m) =>
        m.id === actionId ? { ...m, status: "done" } : m
      );
      void syncTranscript(messagesRef.current);
    }
  };


  const syncTranscript = async (stateSnapshot?: Message[]) => {
    try {
      if (!params.chatId) {
        console.warn("[human-writing][log] missing chatId, skipping sync");
        return;
      }
      const { data: sessionData } = await supabaseBrowserClient.auth.getSession();
      const token = sessionData?.session?.access_token;
      const snapshot = stateSnapshot ?? messagesRef.current;

      const filtered = snapshot.filter((m) => m.role === "user" || m.role === "assistant");
      if (!filtered.length) return;

      const payload = {
        taskId: params.chatId,
        title:
          filtered.find((m) => m.role === "user")?.content?.slice(0, 120) ||
          "Human Writing",
        messages: filtered.map((m) => ({
          role: m.role,
          content: m.content,
          metadata: m.kind ? { kind: m.kind } : {},
        })),
      };
      if (!token) {
        return;
      }

      await fetch("/api/human-writing/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "x-supabase-token": token,
        },
        credentials: "include",
        body: JSON.stringify(payload),
      }).then((res) => {
        if (!res.ok) {
          res.text().then((t) => {
            console.warn("[human-writing][log] non-200", res.status, t);
          });
        }
      });
    } catch (err: any) {
      console.warn("[human-writing][log] sync failed", err?.message || err);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  };

  const handleScroll = () => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    const distance = scrollHeight - (scrollTop + clientHeight);
    const atBottom = distance <= 40;
    setShowScrollToBottom(!atBottom);
    if (!atBottom) {
      setIsAutoScroll(false);
    }
  };

  useEffect(() => {
    if (!isAutoScroll) return;
    scrollToBottom("auto");
  }, [messages, isAutoScroll]);

  return (
    <div className="flex h-screen flex-col bg-[#0f0d12] text-foreground">
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

      <div className="flex flex-1 min-h-0 flex-col">
        <main className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto"
            onScroll={handleScroll}
          >
            <div className="py-4">
              <div className="w-full px-4 sm:px-6 lg:px-12">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                  {messages.map((msg) => {
                  if (msg.kind === "drafting") {
                    return <DraftingMessage key={msg.id} text={msg.content} />;
                  }

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
                  <div className="h-24" aria-hidden="true" />
                </div>
              </div>
            </div>
            {showScrollToBottom && (
              <div className="pointer-events-none fixed inset-x-0 bottom-[120px] z-20">
                <div className="flex w-full justify-center">
                  <Button
                    type="button"
                    size="icon"
                    className="pointer-events-auto h-10 w-10 rounded-full border border-white/15 bg-black/60 text-white shadow-md backdrop-blur hover:bg-black/80"
                    onClick={() => {
                      setIsAutoScroll(true);
                      setShowScrollToBottom(false);
                      scrollToBottom("smooth");
                    }}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </main>

        <div className="flex-none bg-[#0f0d12] px-4 pb-4 pt-3 sm:px-6 lg:px-12">
          <div className="mx-auto w-full max-w-3xl">
            <ChatComposer
              onSendMessage={handleSubmit}
              placeholder="Send a prompt, I'll draft, then ask before running the humanizer..."
              isStreaming={isDrafting || isHumanizing}
            />
          </div>
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
      <style jsx global>{`
        @keyframes shimmer {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 200% 50%;
          }
        }
      `}</style>
    </Suspense>
  );
}

function DraftingMessage({ text }: { text: string }) {
  return (
    <div className="py-4 sm:py-6">
      <div className="mx-auto w-full max-w-3xl px-1.5 sm:px-0">
        <p className="text-sm sm:text-base font-semibold leading-relaxed text-white/60">
          <span className="inline-block bg-[linear-gradient(90deg,rgba(120,126,140,0.9),rgba(255,255,255,0.95),rgba(120,126,140,0.9))] bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_1.4s_linear_infinite]">
            {text}
          </span>
        </p>
      </div>
    </div>
  );
}
