# Supabase Security Warnings - Action Items

## ✅ Fixed in Migration
- **Function Search Path Mutable** - Fixed with migration `20251203_fix_function_search_path.sql`
  - Added `SET search_path = public, pg_temp` to `match_memories` function
  - Added `SET search_path = public, pg_temp` to `sync_memory_embedding` function
- **RLS InitPlan & Duplicate Policies** - Fixed with migration `20251205_optimize_rls_policies.sql`
  - Recreated RLS policies for: `user_preferences`, `conversations`, `messages`, `projects`, `user_api_usage`, `user_plans`, `guest_sessions`, `memories`
  - Wrapped all `auth.uid()` checks with `(select auth.uid())` to avoid per-row evaluation
  - Consolidated overlapping permissive policies so each table/action has a single policy per role

## ⚠️ Requires Manual Action

### 1. Extension in Public Schema (vector)
**Warning**: Extension `vector` is installed in the public schema.

**Why it's a warning**: Extensions in the public schema can cause security issues and conflicts.

**Action**: Move to extensions schema (requires Supabase dashboard or psql):
```sql
-- This requires superuser/admin access - do via Supabase Dashboard SQL Editor
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION vector SET SCHEMA extensions;
```

**Note**: This may break existing functions that reference the vector type. After moving, you may need to update references to use `extensions.vector` instead of just `vector`. However, Supabase typically handles this automatically.

**Alternative**: If this causes issues, you can leave it in public schema. It's a warning, not a critical error.

---

### 2. Leaked Password Protection Disabled
**Warning**: HaveIBeenPwned integration is disabled for Auth.

**Action**: Enable via Supabase Dashboard:
1. Go to Authentication → Policies
2. Enable "Password Strength and Leaked Password Protection"
3. This will prevent users from using compromised passwords

**Impact**: Low risk if you're the only user or using OAuth. Higher risk for public apps with many users.

**Link**: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

---

## Summary
- ✅ **Function search path issues**: Fixed automatically with migration
- ⚠️ **Vector extension in public**: Optional fix, low risk
- ⚠️ **Leaked password protection**: Optional, recommended for production

Apply the migration with:
```bash
# If using Supabase CLI
supabase db push

# Or run the SQL file directly in Supabase Dashboard
```
