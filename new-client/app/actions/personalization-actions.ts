"use server";

import { revalidatePath } from "next/cache";
import { getFullUserPersonalization, updatePersonalization } from "@/lib/data/personalization";
import type { UserPersonalization, UserPreferencesRow } from "@/types/preferences";

export async function getPersonalizationAction() {
  try {
    const prefs = await getFullUserPersonalization();
    return { success: true, data: prefs };
  } catch (error) {
    console.error("Failed to get personalization:", error);
    return { success: false, error: String(error), data: null };
  }
}

export async function updatePersonalizationAction(updates: Partial<UserPreferencesRow>) {
  try {
    await updatePersonalization(updates);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    console.error("Failed to update personalization:", error);
    return { success: false, error: String(error) };
  }
}
