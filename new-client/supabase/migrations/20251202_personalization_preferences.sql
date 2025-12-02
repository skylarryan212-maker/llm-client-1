-- Extend user_preferences table with personalization fields
-- This migration adds comprehensive preference columns for the personalization page

-- Add new columns to user_preferences table
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS locale TEXT DEFAULT 'en-US',
  
  -- Communication style preferences
  ADD COLUMN IF NOT EXISTS tone TEXT DEFAULT 'friendly' CHECK (tone IN ('formal', 'friendly', 'neutral')),
  ADD COLUMN IF NOT EXISTS verbosity TEXT DEFAULT 'normal' CHECK (verbosity IN ('concise', 'normal', 'detailed')),
  ADD COLUMN IF NOT EXISTS code_first BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS emoji_usage BOOLEAN DEFAULT true,
  
  -- Model & routing preferences
  ADD COLUMN IF NOT EXISTS default_model TEXT DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS service_tier TEXT DEFAULT 'auto' CHECK (service_tier IN ('auto', 'standard', 'flex')),
  ADD COLUMN IF NOT EXISTS speed_vs_quality TEXT DEFAULT 'balanced' CHECK (speed_vs_quality IN ('speed', 'balanced', 'quality')),
  ADD COLUMN IF NOT EXISTS web_search_default TEXT DEFAULT 'optional' CHECK (web_search_default IN ('never', 'optional', 'required')),
  ADD COLUMN IF NOT EXISTS context_default TEXT DEFAULT 'recent' CHECK (context_default IN ('minimal', 'recent', 'full')),
  
  -- Sources preferences
  ADD COLUMN IF NOT EXISTS auto_expand_sources BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS strict_citations BOOLEAN DEFAULT true,
  
  -- Privacy preferences
  ADD COLUMN IF NOT EXISTS share_location TEXT DEFAULT 'off' CHECK (share_location IN ('off', 'city', 'precise')),
  ADD COLUMN IF NOT EXISTS retention_days INTEGER DEFAULT 90,
  ADD COLUMN IF NOT EXISTS allow_cache BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_vector_index BOOLEAN DEFAULT true,
  
  -- Accessibility preferences
  ADD COLUMN IF NOT EXISTS font_scale REAL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS high_contrast BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS reduce_motion BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS keyboard_focus BOOLEAN DEFAULT false,
  
  -- Integration toggles (JSONB for flexibility)
  ADD COLUMN IF NOT EXISTS integrations JSONB DEFAULT '{"github": false, "notion": false, "google": false}'::jsonb,
  
  -- Advanced settings
  ADD COLUMN IF NOT EXISTS persona_note TEXT,
  ADD COLUMN IF NOT EXISTS safe_mode BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS experimental_flags JSONB DEFAULT '{}'::jsonb;

-- Add index on user_id for faster lookups (if not exists)
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);

-- Comment the table for documentation
COMMENT ON TABLE public.user_preferences IS 'Extended user preferences including personalization, privacy, and accessibility settings';
COMMENT ON COLUMN public.user_preferences.tone IS 'Communication tone: formal, friendly, or neutral';
COMMENT ON COLUMN public.user_preferences.verbosity IS 'Response length preference: concise, normal, or detailed';
COMMENT ON COLUMN public.user_preferences.service_tier IS 'Preferred service tier for routing: auto (decides based on task), standard, or flex (cost-optimized)';
COMMENT ON COLUMN public.user_preferences.web_search_default IS 'Default web search behavior: never, optional (model decides), or required';
COMMENT ON COLUMN public.user_preferences.share_location IS 'Location sharing preference: off, city (approximate), or precise';
COMMENT ON COLUMN public.user_preferences.persona_note IS 'Custom persona or context to include in system prompt';
