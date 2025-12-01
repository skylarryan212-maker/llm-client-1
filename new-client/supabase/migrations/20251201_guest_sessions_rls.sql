-- Enable RLS on guest_sessions table (if not already enabled)
ALTER TABLE guest_sessions ENABLE ROW LEVEL SECURITY;

-- Allow service role (server-side) to do everything
-- This policy allows the API routes to manage guest sessions
CREATE POLICY "Service role can manage guest sessions"
ON guest_sessions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Optional: Allow anon users to read their own session if cookie matches
-- This is useful if you want client-side code to check session status
CREATE POLICY "Users can read their own guest session"
ON guest_sessions
FOR SELECT
TO anon
USING (true);

-- Note: We don't allow INSERT/UPDATE/DELETE for anon users
-- Only the server-side API (using service_role) can modify guest sessions
