-- Adds/extends columns used by the Personalization + Preferences UI.
-- Safe to run repeatedly (uses IF NOT EXISTS for columns and guards for constraints).

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS accent_color text NOT NULL DEFAULT 'white',
  ADD COLUMN IF NOT EXISTS base_style text,
  ADD COLUMN IF NOT EXISTS custom_instructions text,
  ADD COLUMN IF NOT EXISTS reference_saved_memories boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reference_chat_history boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_saving_memory boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS context_mode_global text NOT NULL DEFAULT 'simple';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_preferences_base_style_check'
  ) THEN
    ALTER TABLE public.user_preferences
      ADD CONSTRAINT user_preferences_base_style_check
      CHECK (
        base_style IS NULL OR base_style IN ('Professional', 'Friendly', 'Concise', 'Creative', 'Robot')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_preferences_context_mode_global_check'
  ) THEN
    ALTER TABLE public.user_preferences
      ADD CONSTRAINT user_preferences_context_mode_global_check
      CHECK (context_mode_global IN ('advanced', 'simple'));
  END IF;
END $$;

