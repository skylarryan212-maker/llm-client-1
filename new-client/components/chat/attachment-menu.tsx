"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookOpen,
  Image,
  MoreHorizontal,
  Network,
  Paperclip,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReactNode } from "react";

const menuItems = [
  { icon: Paperclip, label: "Add photos & files" },
  { icon: Search, label: "Deep research" },
  { icon: Image, label: "Create image" },
  { icon: Network, label: "Agent mode" },
  { icon: BookOpen, label: "Study and learn" },
  { icon: MoreHorizontal, label: "More", hasArrow: true },
];

export function AttachmentMenu({
  trigger,
  open,
  onOpenChange,
  onPickFiles,
  onCreateImage,
}: {
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPickFiles?: () => void;
  onCreateImage?: () => void;
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
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem
              key={item.label}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground"
              onSelect={(event) => {
                event.preventDefault();
                if (item.label === "Add photos & files") {
                  onPickFiles?.();
                  onOpenChange?.(false);
                  return;
                }
                if (item.label === "Create image") {
                  onCreateImage?.();
                  onOpenChange?.(false);
                  return;
                }
                console.log(`TODO: ${item.label}`);
              }}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{item.label}</span>
              {item.hasArrow && (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AttachmentMenuButton({
  open,
  onOpenChange,
  onPickFiles,
  onCreateImage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPickFiles?: () => void;
  onCreateImage?: () => void;
}) {
  return (
    <AttachmentMenu
      open={open}
      onOpenChange={onOpenChange}
      onPickFiles={onPickFiles}
      onCreateImage={onCreateImage}
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
