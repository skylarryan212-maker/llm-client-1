"use server";

import { getUserPreferences, updatePersonalizationPreferences } from "@/lib/data/user-preferences";

export type BaseStylePreset = "Professional" | "Friendly" | "Concise" | "Creative" | "Robot";

export type PersonalizationPreferences = {
  baseStyle: BaseStylePreset;
  customInstructions: string;
  referenceSavedMemories: boolean;
  referenceChatHistory: boolean;
  allowSavingMemory: boolean;
};

const DEFAULT_PREFS: PersonalizationPreferences = {
  baseStyle: "Professional",
  customInstructions: "",
  referenceSavedMemories: true,
  referenceChatHistory: true,
  allowSavingMemory: true,
};

export async function getPersonalizationPreferences(): Promise<PersonalizationPreferences> {
  const row = await getUserPreferences();
  if (!row) return DEFAULT_PREFS;

  return {
    baseStyle: (row.base_style as BaseStylePreset) ?? DEFAULT_PREFS.baseStyle,
    customInstructions: row.custom_instructions ?? DEFAULT_PREFS.customInstructions,
    referenceSavedMemories: row.reference_saved_memories ?? DEFAULT_PREFS.referenceSavedMemories,
    referenceChatHistory: row.reference_chat_history ?? DEFAULT_PREFS.referenceChatHistory,
    allowSavingMemory: row.allow_saving_memory ?? DEFAULT_PREFS.allowSavingMemory,
  };
}

export async function savePersonalizationPreferences(
  prefs: Partial<PersonalizationPreferences>
): Promise<{ success: boolean; message?: string }> {
  try {
    await updatePersonalizationPreferences({
      base_style: prefs.baseStyle,
      custom_instructions: prefs.customInstructions,
      reference_saved_memories: prefs.referenceSavedMemories,
      reference_chat_history: prefs.referenceChatHistory,
      allow_saving_memory: prefs.allowSavingMemory,
    });
    return { success: true };
  } catch (error: any) {
    return { success: false, message: error?.message || "Failed to save preferences" };
  }
}
