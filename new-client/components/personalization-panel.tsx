"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import ManageMemoriesModal from "@/components/memory-manage-modal";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";

const SettingsSchema = z.object({
  customInstructions: z.string().max(4000).optional().default(""),
  referenceSavedMemories: z.boolean().default(true),
  referenceChatHistory: z.boolean().default(true),
  allowSavingMemory: z.boolean().default(true),
  baseStyle: z.enum(["Professional","Friendly","Concise","Creative"]).default("Professional"),
});

type Settings = z.infer<typeof SettingsSchema>;
const STORAGE_KEY = "personalization.memory.v1";

function load(): Settings {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return SettingsSchema.parse({});
    const parsed = JSON.parse(raw);
    return SettingsSchema.parse(parsed);
  } catch {
    return SettingsSchema.parse({});
  }
}

function save(s: Settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

export function PersonalizationPanel() {
  const [settings, setSettings] = useState<Settings>(() => load());
  const [openManage, setOpenManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    const next = { ...settings, [key]: value };
    const parsed = SettingsSchema.safeParse(next);
    if (parsed.success) setSettings(parsed.data);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      save(settings);
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-lg font-medium">Base style and tone</h3>
        <div>
          <label className="block text-sm font-medium mb-1">Style preset</label>
          <Select value={settings.baseStyle} onValueChange={(v) => update("baseStyle", v as Settings["baseStyle"]) }>
            <SelectTrigger>
              <SelectValue placeholder="Select a style" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Professional">Professional</SelectItem>
              <SelectItem value="Friendly">Friendly</SelectItem>
              <SelectItem value="Concise">Concise</SelectItem>
              <SelectItem value="Creative">Creative</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Custom instructions</label>
          <Textarea
            value={settings.customInstructions || ""}
            onChange={(e) => update("customInstructions", e.target.value)}
            placeholder="Tell the assistant how to respond (e.g., be concise, point out flaws, avoid long messages unless asked)."
            rows={4}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Memory</h3>
          <Button variant="outline" size="sm" onClick={() => setOpenManage(true)}>Manage</Button>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Reference saved memories</p>
              <p className="text-xs text-muted-foreground">Let the assistant use saved user info and preferences.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.referenceSavedMemories}
              onChange={(e) => update("referenceSavedMemories", e.target.checked)}
              className="h-4 w-4"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Reference chat history</p>
              <p className="text-xs text-muted-foreground">Allow previous conversations to inform responses.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.referenceChatHistory}
              onChange={(e) => update("referenceChatHistory", e.target.checked)}
              className="h-4 w-4"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Allow saving memory</p>
              <p className="text-xs text-muted-foreground">If off, we do not write memories to Supabase.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.allowSavingMemory}
              onChange={(e) => update("allowSavingMemory", e.target.checked)}
              className="h-4 w-4"
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between pt-4 border-t">
        <div>
          {savedAt && (
            <p className="text-xs text-muted-foreground">Saved {new Date(savedAt).toLocaleTimeString()}</p>
          )}
        </div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <ManageMemoriesModal open={openManage} onOpenChange={setOpenManage} />
    </div>
  );
}
