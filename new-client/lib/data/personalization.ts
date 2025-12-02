import { supabaseServer } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { UserPersonalization, UserPreferencesRow, dbRowToPersonalization } from "@/types/preferences";
import { dbRowToPersonalization as convertRow } from "@/types/preferences";

export async function getFullUserPersonalization(): Promise<UserPersonalization | null> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Failed to load personalization:", error);
    throw new Error(`Failed to load user personalization: ${error.message}`);
  }

  if (!data) {
    // Return defaults if no preferences exist
    return getDefaultPersonalization();
  }

  return convertRow(data as UserPreferencesRow);
}

export async function updatePersonalization(updates: Partial<UserPreferencesRow>): Promise<void> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();

  // Check if preferences exist
  const { data: existing } = await supabase
    .from("user_preferences")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    // Update existing
    const { error } = await supabase
      .from("user_preferences")
      .update({ ...updates, updated_at: now })
      .eq("user_id", userId);

    if (error) {
      throw new Error(`Failed to update personalization: ${error.message}`);
    }
  } else {
    // Insert new
    const { error } = await supabase
      .from("user_preferences")
      .insert([{ user_id: userId, ...updates, updated_at: now }]);

    if (error) {
      throw new Error(`Failed to create personalization: ${error.message}`);
    }
  }
}

function getDefaultPersonalization(): UserPersonalization {
  return {
    displayName: null,
    avatarUrl: null,
    timezone: 'America/New_York',
    locale: 'en-US',
    accentColor: 'white',
    
    communication: {
      tone: 'friendly',
      verbosity: 'normal',
      codeFirst: false,
      emojiUsage: true,
    },
    
    models: {
      defaultModel: 'auto',
      serviceTier: 'auto',
      speedVsQuality: 'balanced',
      webSearchDefault: 'optional',
      contextDefault: 'recent',
    },
    
    sources: {
      autoExpandSources: false,
      strictCitations: true,
    },
    
    privacy: {
      shareLocation: 'off',
      retentionDays: 90,
      allowCache: true,
      allowVectorIndex: true,
    },
    
    accessibility: {
      fontScale: 1.0,
      highContrast: false,
      reduceMotion: false,
      keyboardFocus: false,
    },
    
    integrations: {
      github: false,
      notion: false,
      google: false,
    },
    
    advanced: {
      personaNote: null,
      safeMode: false,
      experimentalFlags: {},
    },
  };
}
