import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { Database } from "@/lib/supabase/types";

type UserPreferencesRow = Database["public"]["Tables"]["user_preferences"]["Row"];
type UserPreferencesInsert = Database["public"]["Tables"]["user_preferences"]["Insert"];
type UserPreferencesUpdate = Database["public"]["Tables"]["user_preferences"]["Update"];

export async function getUserPreferences() {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

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
  const userId = await requireUserIdServer();
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

export async function updatePersonalizationPreferences(update: {
  base_style?: UserPreferencesUpdate["base_style"];
  custom_instructions?: UserPreferencesUpdate["custom_instructions"];
  reference_saved_memories?: UserPreferencesUpdate["reference_saved_memories"];
  reference_chat_history?: UserPreferencesUpdate["reference_chat_history"];
  allow_saving_memory?: UserPreferencesUpdate["allow_saving_memory"];
}) {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const existing = await getUserPreferences();
  const updated_at = new Date().toISOString();

  if (existing) {
    const patch: UserPreferencesUpdate = { ...update, updated_at };
    const { data, error } = await supabaseAny
      .from("user_preferences")
      .update(patch)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw new Error(`Failed to update user preferences: ${error.message}`);
    return data;
  }

  const insert: UserPreferencesInsert = { user_id: userId, accent_color: "white", ...update };
  const { data, error } = await supabaseAny
    .from("user_preferences")
    .insert([insert])
    .select()
    .single();
  if (error) throw new Error(`Failed to create user preferences: ${error.message}`);
  return data;
}

export async function updateContextModeGlobal(contextModeGlobal: "advanced" | "simple") {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const existing = await getUserPreferences();
  const updated_at = new Date().toISOString();

  if (existing) {
    const patch: UserPreferencesUpdate = { context_mode_global: contextModeGlobal, updated_at };
    const { data, error } = await supabaseAny
      .from("user_preferences")
      .update(patch)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw new Error(`Failed to update context mode: ${error.message}`);
    return data;
  }

  const insert: UserPreferencesInsert = {
    user_id: userId,
    accent_color: "white",
    context_mode_global: contextModeGlobal,
  };
  const { data, error } = await supabaseAny
    .from("user_preferences")
    .insert([insert])
    .select()
    .single();
  if (error) throw new Error(`Failed to create user preferences: ${error.message}`);
  return data;
}
