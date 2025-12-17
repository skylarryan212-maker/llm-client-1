"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { fetchMemories, deleteMemory, MemoryType, MemoryItem } from "@/lib/memory";

import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";



export default function ManageMemoriesModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<MemoryType | "all">("all");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function loadMemories() {
    setLoading(true);
    try {
      // Note: client-side fetch without userId will use client auth context
      const data = await fetchMemories({ query, types: type });
      setItems(data);
    } catch (err) {
      console.error("Failed to load memories:", err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    loadMemories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type]);

  useEffect(() => {
    if (!open) return;
    // Debounce search
    const t = setTimeout(() => { loadMemories(); }, 300);
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
          <h2 className="text-lg font-semibold">Saved memories</h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close saved memories"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Input
                placeholder="Search memories"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div>
              <Select value={type} onValueChange={(v) => setType(v as MemoryType | "all")}>
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
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
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
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
