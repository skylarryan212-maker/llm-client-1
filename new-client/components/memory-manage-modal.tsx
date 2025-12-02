"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

// Memory item type for UI only; backend hooks will replace stub data
const MemoryItemSchema = z.object({
  id: z.string(),
  type: z.enum(["preference","identity","constraint","workflow","project","instruction","other"]).default("other"),
  title: z.string(),
  content: z.string(),
  enabled: z.boolean().default(true),
  created_at: z.string().optional(),
});
type MemoryItem = z.infer<typeof MemoryItemSchema>;

export default function ManageMemoriesModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string>("all");
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const load = async () => {
      setLoading(true);
      try {
        // TODO: replace with Supabase fetch
        const stub: MemoryItem[] = [
          { id: "1", type: "preference", title: "Prefers concise replies", content: "User prefers concise, direct responses.", enabled: true },
          { id: "2", type: "identity", title: "Nickname: Sky", content: "Call the user 'Sky'.", enabled: true },
        ];
        setItems(stub);
      } finally { setLoading(false); }
    };
    load();
  }, [open]);

  const filtered = useMemo(() => {
    return items.filter(i => {
      const matchType = type === "all" ? true : i.type === type;
      const q = query.trim().toLowerCase();
      const matchQuery = !q || i.title.toLowerCase().includes(q) || i.content.toLowerCase().includes(q);
      return matchType && matchQuery;
    });
  }, [items, type, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Saved memories</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <Input placeholder="Search memories" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div>
              <Select value={type} onValueChange={setType}>
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
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">No memories found.</p>
            ) : (
              filtered.map(m => (
                <div key={m.id} className="rounded border p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium">{m.title}</p>
                      <p className="text-xs text-muted-foreground">{m.type}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline">Disable</Button>
                      <Button size="sm" variant="destructive">Delete</Button>
                    </div>
                  </div>
                  <p className="text-sm mt-2">{m.content}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
