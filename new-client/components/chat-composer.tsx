"use client";

import { useState, KeyboardEvent, FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, ArrowUp } from "lucide-react";
import { AttachmentMenuButton } from "@/components/chat/attachment-menu";

type ChatComposerProps = {
  onSubmit?: (message: string) => void;
  onSendMessage?: (message: string) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  onRegenerate?: () => void;
  placeholder?: string;
};

export function ChatComposer({
  onSubmit,
  onSendMessage,
  isStreaming,
  onStop,
  onRegenerate,
  placeholder,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const effectiveSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (onSubmit) onSubmit(trimmed);
    else if (onSendMessage) onSendMessage(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      effectiveSubmit(value);
    }
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    effectiveSubmit(value);
  };

  return (
    <form onSubmit={handleFormSubmit}>
      <div className="relative flex items-end gap-1.5 sm:gap-2 rounded-3xl border border-border bg-muted/30 px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5 transition-all focus-within:border-ring focus-within:bg-background">
        {/* Left action button (plus) */}
        <div className="flex items-center pb-0.5 sm:pb-0">
          <AttachmentMenuButton
            open={isMenuOpen}
            onOpenChange={setIsMenuOpen}
          />
        </div>

        {/* Textarea */}
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Message LLM Client..."}
          rows={1}
          className="flex-1 min-h-[36px] max-h-[200px] border-0 bg-transparent dark:bg-transparent px-0 py-2 text-sm leading-5 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none rounded-none"
        />

        {/* Right actions: mic + send OR stop/regenerate if streaming */}
        <div className="flex shrink-0 items-end gap-0.5 sm:gap-1 pb-0.5 sm:pb-0">
          {!isStreaming ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 sm:size-9 rounded-full hover:bg-accent"
              >
                <Mic className="h-4 w-4" />
              </Button>
              <Button
                type="submit"
                size="icon"
                className="size-8 sm:size-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={!value.trim()}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onStop}
              >
                Stop
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRegenerate}
              >
                Regenerate
              </Button>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
