-- Create a lookup table that stores tokens issued to users for token-based authentication.
-- Tokens are generated per user and should only be readable by their owner.
CREATE TABLE IF NOT EXISTS public.token_auth_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS token_auth_keys_user_id_idx ON public.token_auth_keys (user_id);

ALTER TABLE public.token_auth_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Token owners can read their key" ON public.token_auth_keys
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

