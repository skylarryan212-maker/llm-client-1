"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import ManageMemoriesModal from "@/components/memory-manage-modal";
import { getPersonalizationPreferences, savePersonalizationPreferences } from "@/app/actions/user-preferences-actions";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";

const SettingsSchema = z.object({
  customInstructions: z.string().max(4000).optional().default(""),
  referenceSavedMemories: z.boolean().default(true),
  referenceChatHistory: z.boolean().default(true),
  allowSavingMemory: z.boolean().default(true),
  baseStyle: z.enum(["Professional","Friendly","Concise","Creative","Robot"]).default("Professional"),
});

type Settings = z.infer<typeof SettingsSchema>;

const PERSONALIZATION_SETTINGS_CACHE_KEY = "llm-client-personalization-settings-cache";

function loadCachedSettings(): Settings {
  if (typeof window === "undefined") return SettingsSchema.parse({});
  try {
    const raw = window.localStorage.getItem(PERSONALIZATION_SETTINGS_CACHE_KEY);
    if (!raw) return SettingsSchema.parse({});
    return SettingsSchema.parse(JSON.parse(raw));
  } catch {
    return SettingsSchema.parse({});
  }
}

function persistCachedSettings(settings: Settings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PERSONALIZATION_SETTINGS_CACHE_KEY,
      JSON.stringify(settings)
    );
  } catch {
    // ignore storage errors
  }
}

function ThemedCheckbox(props: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onCheckedChange(e.target.checked)}
        className="peer h-5 w-5 shrink-0 appearance-none rounded-md border border-border bg-background shadow-sm transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Check className="pointer-events-none absolute left-0 top-0 h-5 w-5 p-[3px] text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
    </div>
  );
}

async function load(): Promise<Settings> {
  try {
    const prefs = await getPersonalizationPreferences();
    return SettingsSchema.parse({
      customInstructions: prefs.customInstructions,
      referenceSavedMemories: prefs.referenceSavedMemories,
      referenceChatHistory: prefs.referenceChatHistory,
      allowSavingMemory: prefs.allowSavingMemory,
      baseStyle: prefs.baseStyle,
    });
  } catch {
    return SettingsSchema.parse({});
  }
}

export function PersonalizationPanel() {
  const [settings, setSettings] = useState<Settings>(() => loadCachedSettings());
  const hasEditedRef = useRef(false);
  const [openManage, setOpenManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<Settings | null>(null);
  const saveInFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  function queueSave(next: Settings) {
    pendingSaveRef.current = next;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void savePending();
    }, 650);
  }

  async function savePending() {
    if (saveInFlightRef.current) return;
    const snapshot = pendingSaveRef.current;
    if (!snapshot) return;

    pendingSaveRef.current = null;
    saveInFlightRef.current = true;
    if (isMountedRef.current) {
      setSaving(true);
    }

    try {
      const result = await savePersonalizationPreferences({
        baseStyle: snapshot.baseStyle,
        customInstructions: snapshot.customInstructions || "",
        referenceSavedMemories: snapshot.referenceSavedMemories,
        referenceChatHistory: snapshot.referenceChatHistory,
        allowSavingMemory: snapshot.allowSavingMemory,
      });
      if (!result.success) {
        if (isMountedRef.current) {
          setSaveError(result.message || "Failed to save changes");
        }
        return;
      }

      persistCachedSettings(snapshot);

      if (isMountedRef.current) {
        setSaveError(null);
        setSavedAt(Date.now());
      }
    } catch {
      if (isMountedRef.current) {
        setSaveError("Failed to save changes");
      }
    } finally {
      saveInFlightRef.current = false;
      if (isMountedRef.current) {
        setSaving(false);
      }

      if (pendingSaveRef.current) {
        queueSave(pendingSaveRef.current);
      }
    }
  }

  useEffect(() => {
    let alive = true;
    load().then((next) => {
      if (!alive) return;
      persistCachedSettings(next);
      if (!hasEditedRef.current) {
        setSettings(next);
      }
    });
    return () => {
      alive = false;
      isMountedRef.current = false;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (!saveInFlightRef.current && pendingSaveRef.current) {
        const snapshot = pendingSaveRef.current;
        pendingSaveRef.current = null;
        persistCachedSettings(snapshot);
        void savePersonalizationPreferences({
          baseStyle: snapshot.baseStyle,
          customInstructions: snapshot.customInstructions || "",
          referenceSavedMemories: snapshot.referenceSavedMemories,
          referenceChatHistory: snapshot.referenceChatHistory,
          allowSavingMemory: snapshot.allowSavingMemory,
        }).catch(() => {});
      }
    };
  }, []);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    if (!settings) return;
    hasEditedRef.current = true;
    const next = { ...settings, [key]: value };
    const parsed = SettingsSchema.safeParse(next);
    if (!parsed.success) return;

    setSettings(parsed.data);
    persistCachedSettings(parsed.data);
    setSaveError(null);
    queueSave(parsed.data);
  };

  if (!settings) return <div>Loading...</div>;

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
              <SelectItem value="Robot">Robot</SelectItem>
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
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 p-4">
            <div>
              <label htmlFor="referenceSavedMemories" className="text-sm font-medium leading-none cursor-pointer">
                Reference saved memories
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Let the assistant use saved user info and preferences.</p>
            </div>
            <ThemedCheckbox
              id="referenceSavedMemories"
              checked={settings.referenceSavedMemories}
              onCheckedChange={(checked) => update("referenceSavedMemories", checked)}
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 p-4">
            <div>
              <label htmlFor="referenceChatHistory" className="text-sm font-medium leading-none cursor-pointer">
                Reference chat history
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Allow previous conversations to inform responses.</p>
            </div>
            <ThemedCheckbox
              id="referenceChatHistory"
              checked={settings.referenceChatHistory}
              onCheckedChange={(checked) => update("referenceChatHistory", checked)}
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/20 p-4">
            <div>
              <label htmlFor="allowSavingMemory" className="text-sm font-medium leading-none cursor-pointer">
                Allow saving memory
              </label>
              <p className="mt-1 text-xs text-muted-foreground">If off, we do not write memories to Supabase.</p>
            </div>
            <ThemedCheckbox
              id="allowSavingMemory"
              checked={settings.allowSavingMemory}
              onCheckedChange={(checked) => update("allowSavingMemory", checked)}
            />
          </div>
        </div>
      </section>

      <div className="pt-4 border-t">
        {saveError ? (
          <p className="text-xs text-red-400">{saveError}</p>
        ) : saving ? (
          <p className="text-xs text-muted-foreground">Saving...</p>
        ) : savedAt ? (
          <p className="text-xs text-muted-foreground">Saved {new Date(savedAt).toLocaleTimeString()}</p>
        ) : null}
      </div>

      <ManageMemoriesModal open={openManage} onOpenChange={setOpenManage} />
    </div>
  );
}
