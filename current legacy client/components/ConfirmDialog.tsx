"use client";

import type { ReactNode } from "react";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTone?: "default" | "destructive";
  confirmLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  confirmTone = "destructive",
  confirmLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl border border-[#2a2a30] bg-[#121217] p-5 text-sm text-zinc-200 shadow-2xl">
        <div className="text-base font-semibold text-white">{title}</div>
        <div className="mt-2 text-[13px] leading-relaxed text-zinc-400">{body}</div>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            className="rounded-full border border-[#3a3a40] px-4 py-1.5 text-[13px] text-zinc-300 hover:border-[#4b64ff] hover:text-white"
            onClick={onCancel}
            disabled={confirmLoading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${
              confirmTone === "destructive"
                ? "bg-red-500/20 text-red-200 hover:bg-red-500/30"
                : "bg-[#1e4fd8] text-white hover:bg-[#325cff]"
            } ${confirmLoading ? "opacity-60" : ""}`}
            onClick={onConfirm}
            disabled={confirmLoading}
          >
            {confirmLoading ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
