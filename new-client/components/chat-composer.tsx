"use client";

import { useState, KeyboardEvent, FormEvent, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, ArrowUp, Square } from "lucide-react";
import { AttachmentMenuButton } from "@/components/chat/attachment-menu";

type UploadedFragment = {
  id: string;
  name: string;
  dataUrl: string;
  mime?: string;
  size?: number;
};

type ChatComposerProps = {
  onSubmit?: (message: string, attachments?: UploadedFragment[]) => void;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<UploadedFragment[]>([]);
  const trimmedValue = value.trim();

  const effectiveSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (onSubmit) onSubmit(trimmed, attachments);
    else if (onSendMessage) onSendMessage(trimmed);
    setValue("");
    setAttachments([]);
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

  const handleOpenFilePicker = () => {
    // Close the menu and open the native file picker
    setIsMenuOpen(false);
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      // Convert files to base64 data URLs (like legacy client)
      const fileReads = Array.from(files).map(file => {
        return new Promise<UploadedFragment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              name: file.name,
              dataUrl: reader.result as string,
              mime: file.type || undefined,
              size: file.size,
            });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
      });
      
      const newItems = await Promise.all(fileReads);
      setAttachments((prev) => [...prev, ...newItems]);
      
      // Reset the file input to allow re-selecting the same file later
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (err) {
      console.error("File read error:", err);
    }
  };

  return (
    <form onSubmit={handleFormSubmit}>
      {/* Attachments preview list (above composer) */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div key={a.id} className="group flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3 py-2">
              <div className="h-8 w-8 overflow-hidden rounded-lg bg-background/40 flex items-center justify-center">
                {a.mime?.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.dataUrl} alt={a.name} className="h-full w-full object-cover" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
                    <path d="M14 3v6h6" />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{a.name}</div>
              </div>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}>
                ×
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="relative flex items-end gap-1.5 sm:gap-2 rounded-3xl border border-border bg-muted/30 px-2 sm:px-3 lg:px-4 py-2 sm:py-2.5 transition-all focus-within:border-ring focus-within:bg-background">
        {/* Left action button (plus) */}
        <div className="flex items-center pb-0.5 sm:pb-0">
          <AttachmentMenuButton
            open={isMenuOpen}
            onOpenChange={setIsMenuOpen}
            onPickFiles={handleOpenFilePicker}
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 sm:size-9 rounded-full hover:bg-accent"
          >
            <Mic className="h-4 w-4" />
          </Button>
          {!isStreaming ? (
            trimmedValue ? (
              <Button
                type="submit"
                size="icon"
                className="size-8 sm:size-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                className="size-8 sm:size-9 rounded-full bg-white text-zinc-900 shadow-sm"
                onClick={(event) => event.preventDefault()}
                aria-label="Start voice input"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 66 56"
                  className="h-6 w-6"
                  fill="none"
                >
                  <rect x="0" y="15" width="12" height="30" rx="" fill="currentColor" />
                  <rect x="18" y="0" width="12" height="70" rx="3" fill="currentColor" />
                  <rect x="36" y="6" width="12" height="50" rx="3" fill="currentColor" />
                  <rect x="55" y="15" width="12" height="30" rx="3" fill="currentColor" />
                </svg>
              </Button>
            )
          ) : (
            <Button
              type="button"
              size="icon"
              className="size-8 sm:size-9 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={onStop}
              aria-label="Stop generating"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="currentColor"
              >
                <rect x="4" y="4" width="16" height="16" rx="3" />
              </svg>
            </Button>
          )}
        </div>
      </div>
      
      {/* Hidden file input for attachments */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,application/pdf,application/*,text/*"
        className="hidden"
        onChange={(e) => handleFilesSelected(e.target.files)}
      />
    </form>
  );
}
