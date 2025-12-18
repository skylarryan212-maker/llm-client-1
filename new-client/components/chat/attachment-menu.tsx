"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bot, Image as ImageIcon, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";
import { AgentPickerPanel } from "@/components/chat/agent-picker-panel";

export function AttachmentMenu({
  trigger,
  open,
  onOpenChange,
  onPickFiles,
  onCreateImage,
  selectedAgentId,
  onSelectAgent,
  onClearAgent,
}: {
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPickFiles?: () => void;
  onCreateImage?: () => void;
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
  onClearAgent?: () => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-64 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
      >
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground cursor-pointer">
            <Bot className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Agents</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            sideOffset={10}
            className="rounded-xl border border-border bg-popover p-0 shadow-lg"
          >
            <AgentPickerPanel
              selectedAgentId={selectedAgentId ?? null}
              onSelectAgentId={(id) => onSelectAgent?.(id)}
              onClearAgentId={onClearAgent}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground"
          onSelect={(event) => {
            event.preventDefault();
            onPickFiles?.();
            onOpenChange?.(false);
          }}
        >
          <Paperclip className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Add photos & files</span>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground"
          onSelect={(event) => {
            event.preventDefault();
            onCreateImage?.();
            onOpenChange?.(false);
          }}
        >
          <ImageIcon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">Create image</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AttachmentMenuButton({
  open,
  onOpenChange,
  onPickFiles,
  onCreateImage,
  selectedAgentId,
  onSelectAgent,
  onClearAgent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickFiles?: () => void;
  onCreateImage?: () => void;
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
  onClearAgent?: () => void;
}) {
  return (
    <AttachmentMenu
      open={open}
      onOpenChange={onOpenChange}
      onPickFiles={onPickFiles}
      onCreateImage={onCreateImage}
      selectedAgentId={selectedAgentId}
      onSelectAgent={onSelectAgent}
      onClearAgent={onClearAgent}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-full hover:bg-accent"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <line x1="12" x2="12" y1="5" y2="19" />
            <line x1="5" x2="19" y1="12" y2="12" />
          </svg>
        </Button>
      }
    />
  );
}
