import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserId } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type UserPreferencesRow = Database["public"]["Tables"]["user_preferences"]["Row"];
type UserPreferencesInsert = Database["public"]["Tables"]["user_preferences"]["Insert"];
type UserPreferencesUpdate = Database["public"]["Tables"]["user_preferences"]["Update"];

export async function getUserPreferences() {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();

  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle<UserPreferencesRow>();

  if (error && error.code !== "PGRST116") {
    // PGRST116 is "not found", which is ok - we'll create it
    throw new Error(`Failed to load user preferences: ${error.message}`);
  }

  return data;
}

export async function updateAccentColor(accentColor: string) {
  const supabase = await supabaseServer();
  const userId = getCurrentUserId();
  const supabaseAny = supabase as any;

  // First, try to get existing preferences
  const existing = await getUserPreferences();

  if (existing) {
    // Update existing record
    const update: UserPreferencesUpdate = {
      accent_color: accentColor,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAny
      .from("user_preferences")
      .update(update)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update accent color: ${error.message}`);
    }

    return data;
  } else {
    // Insert new record
    const insert: UserPreferencesInsert = {
      user_id: userId,
      accent_color: accentColor,
    };

    const { data, error } = await supabaseAny
      .from("user_preferences")
      .insert([insert])
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create user preferences: ${error.message}`);
    }

    return data;
  }
}
