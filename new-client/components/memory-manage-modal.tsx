"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { fetchMemories, deleteMemory, MemoryItem, MemoryType } from "@/lib/memory";

import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

type PermanentInstructionRow = {
  id: string;
  scope: "user" | "conversation";
  title: string | null;
  content: string;
  conversation_id: string | null;
  created_at: string | null;
};

export default function ManageMemoriesModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState<"memories" | "instructions">("memories");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<MemoryType | "all">("all");

  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [instructions, setInstructions] = useState<PermanentInstructionRow[]>([]);
  const [instructionsLoading, setInstructionsLoading] = useState(false);

  async function loadMemories() {
    setLoading(true);
    try {
      const data = await fetchMemories({ query, types: type });
      setItems(data);
    } catch (err) {
      console.error("Failed to load memories:", err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadPermanentInstructions() {
    setInstructionsLoading(true);
    try {
      const { default: supabaseClient } = await import("@/lib/supabase/browser-client");

      let q = supabaseClient
        .from("permanent_instructions")
        .select("id, scope, title, content, conversation_id, created_at")
        .eq("enabled", true)
        .order("priority", { ascending: false })
        .order("created_at", { ascending: true });

      const trimmed = query.trim();
      if (trimmed) {
        const escaped = trimmed.replaceAll(",", "\\,");
        q = q.or(`content.ilike.%${escaped}%,title.ilike.%${escaped}%`);
      }

      const { data, error } = await q;
      if (error) {
        console.error("Failed to load permanent instructions:", error);
        setInstructions([]);
        return;
      }

      setInstructions((data ?? []) as PermanentInstructionRow[]);
    } catch (err) {
      console.error("Failed to load permanent instructions:", err);
      setInstructions([]);
    } finally {
      setInstructionsLoading(false);
    }
  }

  async function deletePermanentInstruction(id: string) {
    try {
      const { default: supabaseClient } = await import("@/lib/supabase/browser-client");
      const { error } = await supabaseClient
        .from("permanent_instructions")
        .delete()
        .eq("id", id);
      if (error) {
        console.error("Failed to delete permanent instruction:", error);
        return;
      }
      loadPermanentInstructions();
    } catch (err) {
      console.error("Failed to delete permanent instruction:", err);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadMemories();
    loadPermanentInstructions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      loadMemories();
      loadPermanentInstructions();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <Dialog
      open={open}
      onClose={() => onOpenChange(false)}
      contentClassName="flex w-full max-w-[min(720px,95vw)] flex-col max-h-[70vh] overflow-hidden p-0"
    >
      <div className="flex min-h-0 flex-col">
        <div className="px-5 pt-5 pb-3 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Personalization data</h2>
            <div className="mt-3 flex gap-1 rounded-lg bg-muted/30 p-1 w-fit">
              <Button
                type="button"
                variant={activeTab === "memories" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-3"
                onClick={() => setActiveTab("memories")}
              >
                Memories
              </Button>
              <Button
                type="button"
                variant={activeTab === "instructions" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 px-3"
                onClick={() => setActiveTab("instructions")}
              >
                Permanent instructions
              </Button>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close personalization data"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 min-h-0 overflow-hidden p-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Input
                placeholder={activeTab === "instructions" ? "Search permanent instructions" : "Search memories"}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {activeTab === "memories" ? (
              <div>
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as MemoryType | "all")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent className="z-[1100]">
                    <SelectItem value="all">All types</SelectItem>
                    <SelectItem value="preference">Preference</SelectItem>
                    <SelectItem value="identity">Identity</SelectItem>
                    <SelectItem value="constraint">Constraint</SelectItem>
                    <SelectItem value="workflow">Workflow</SelectItem>
                    <SelectItem value="project">Project</SelectItem>
                    <SelectItem value="instruction">Instruction</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="hidden sm:block" />
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
            {activeTab === "memories" ? (
              loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No memories found.</p>
              ) : (
                items.map((m) => (
                  <div key={m.id} className="rounded border border-border bg-card/60 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">{m.title}</p>
                        <p className="text-xs text-muted-foreground capitalize">{m.type}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={async () => {
                            await deleteMemory(m.id);
                            loadMemories();
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm text-foreground/90">{m.content}</p>
                  </div>
                ))
              )
            ) : instructionsLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : instructions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No permanent instructions found.</p>
            ) : (
              instructions.map((inst) => {
                const scopeLabel = inst.scope === "conversation" ? "Conversation" : "User";
                return (
                  <div key={inst.id} className="rounded border border-border bg-card/60 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {inst.title?.trim() ? inst.title : "Untitled instruction"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {scopeLabel}
                          {inst.scope === "conversation" && inst.conversation_id
                            ? ` • ${inst.conversation_id}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deletePermanentInstruction(inst.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90">
                      {inst.content}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
