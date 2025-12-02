// Personalization preference types

export type Tone = 'formal' | 'friendly' | 'neutral';
export type Verbosity = 'concise' | 'normal' | 'detailed';
export type ServiceTier = 'auto' | 'standard' | 'flex';
export type SpeedVsQuality = 'speed' | 'balanced' | 'quality';
export type WebSearchDefault = 'never' | 'optional' | 'required';
export type ContextDefault = 'minimal' | 'recent' | 'full';
export type ShareLocation = 'off' | 'city' | 'precise';

export interface CommunicationStyle {
  tone: Tone;
  verbosity: Verbosity;
  codeFirst: boolean;
  emojiUsage: boolean;
}

export interface ModelPreferences {
  defaultModel: string;
  serviceTier: ServiceTier;
  speedVsQuality: SpeedVsQuality;
  webSearchDefault: WebSearchDefault;
  contextDefault: ContextDefault;
}

export interface SourcesPreferences {
  autoExpandSources: boolean;
  strictCitations: boolean;
}

export interface PrivacyPreferences {
  shareLocation: ShareLocation;
  retentionDays: number;
  allowCache: boolean;
  allowVectorIndex: boolean;
}

export interface AccessibilityPreferences {
  fontScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
  keyboardFocus: boolean;
}

export interface IntegrationsPreferences {
  github: boolean;
  notion: boolean;
  google: boolean;
}

export interface AdvancedPreferences {
  personaNote: string | null;
  safeMode: boolean;
  experimentalFlags: Record<string, boolean>;
}

export interface UserPersonalization {
  // Profile
  displayName: string | null;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  accentColor: string;

  // Preferences
  communication: CommunicationStyle;
  models: ModelPreferences;
  sources: SourcesPreferences;
  privacy: PrivacyPreferences;
  accessibility: AccessibilityPreferences;
  integrations: IntegrationsPreferences;
  advanced: AdvancedPreferences;
}

// Database row type
export interface UserPreferencesRow {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  locale: string;
  accent_color: string;
  
  tone: Tone;
  verbosity: Verbosity;
  code_first: boolean;
  emoji_usage: boolean;
  
  default_model: string;
  service_tier: ServiceTier;
  speed_vs_quality: SpeedVsQuality;
  web_search_default: WebSearchDefault;
  context_default: ContextDefault;
  
  auto_expand_sources: boolean;
  strict_citations: boolean;
  
  share_location: ShareLocation;
  retention_days: number;
  allow_cache: boolean;
  allow_vector_index: boolean;
  
  font_scale: number;
  high_contrast: boolean;
  reduce_motion: boolean;
  keyboard_focus: boolean;
  
  integrations: {
    github: boolean;
    notion: boolean;
    google: boolean;
  };
  
  persona_note: string | null;
  safe_mode: boolean;
  experimental_flags: Record<string, boolean>;
  
  created_at: string | null;
  updated_at: string | null;
}

// Helper to convert DB row to typed personalization object
export function dbRowToPersonalization(row: UserPreferencesRow): UserPersonalization {
  return {
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    locale: row.locale,
    accentColor: row.accent_color,
    
    communication: {
      tone: row.tone,
      verbosity: row.verbosity,
      codeFirst: row.code_first,
      emojiUsage: row.emoji_usage,
    },
    
    models: {
      defaultModel: row.default_model,
      serviceTier: row.service_tier,
      speedVsQuality: row.speed_vs_quality,
      webSearchDefault: row.web_search_default,
      contextDefault: row.context_default,
    },
    
    sources: {
      autoExpandSources: row.auto_expand_sources,
      strictCitations: row.strict_citations,
    },
    
    privacy: {
      shareLocation: row.share_location,
      retentionDays: row.retention_days,
      allowCache: row.allow_cache,
      allowVectorIndex: row.allow_vector_index,
    },
    
    accessibility: {
      fontScale: row.font_scale,
      highContrast: row.high_contrast,
      reduceMotion: row.reduce_motion,
      keyboardFocus: row.keyboard_focus,
    },
    
    integrations: row.integrations,
    
    advanced: {
      personaNote: row.persona_note,
      safeMode: row.safe_mode,
      experimentalFlags: row.experimental_flags,
    },
  };
}

// Helper for partial updates
export type PersonalizationUpdate = Partial<UserPersonalization>;
