"use client";

import { useEffect, useState } from "react";
import { fetchMemories, updateMemoryEnabled, deleteMemory, MemoryType, MemoryItem } from "@/lib/memory";

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
      const data = await fetchMemories({ query, types: type, useSemanticSearch: false });
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
  
  // Poll for updates while modal is open (to catch memories saved during chat)
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      loadMemories();
    }, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, type]);



  return (
    <Dialog open={open} onClose={() => onOpenChange(false)}>
      <div className="sm:max-w-2xl">
        <div className="mb-3">
          <h2 className="text-lg font-semibold">Saved memories</h2>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <Input placeholder="Search memories" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div>
              <Select value={type} onValueChange={v => setType(v as MemoryType | "all") }>
                <SelectTrigger>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
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

          <div className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No memories found.</p>
            ) : (
              items.map(m => (
                <div key={m.id} className="rounded border p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium">{m.title}</p>
                      <p className="text-xs text-muted-foreground">{m.type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={async () => { await updateMemoryEnabled(m.id, !m.enabled); loadMemories(); }}>{m.enabled ? "Disable" : "Enable"}</Button>
                      <Button size="sm" variant="destructive" onClick={async () => { await deleteMemory(m.id); loadMemories(); }}>Delete</Button>
                    </div>
                  </div>
                  <p className="text-sm mt-2">{m.content}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
