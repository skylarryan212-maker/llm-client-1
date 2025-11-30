"use server";

import { revalidatePath } from "next/cache";
import { updateAccentColor } from "@/lib/data/user-preferences";

export async function updateAccentColorAction(accentColor: string) {
  try {
    await updateAccentColor(accentColor);
    revalidatePath("/", "layout");
    return { success: true };
  } catch (error) {
    console.error("Failed to update accent color:", error);
    return { success: false, error: String(error) };
  }
}
