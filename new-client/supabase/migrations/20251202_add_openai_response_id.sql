-- Add openai_response_id column to messages table
-- This enables OpenAI context chaining for cost savings and performance

ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS openai_response_id TEXT;

-- Add index for faster lookups when checking for previous response IDs
CREATE INDEX IF NOT EXISTS idx_messages_openai_response_id 
ON public.messages(openai_response_id);

-- Add index for faster conversation+role queries (used to find last assistant message)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_role 
ON public.messages(conversation_id, role, created_at DESC);

COMMENT ON COLUMN public.messages.openai_response_id IS 
'OpenAI response ID for context chaining via previous_response_id parameter';
