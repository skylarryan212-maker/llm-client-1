"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/supabase/types";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/constants";

// Client-side Supabase instance that persists session and shares it with the server via cookies.
export const supabaseBrowserClient = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  {
    auth: { storageKey: SUPABASE_AUTH_STORAGE_KEY },
  }
);

export default supabaseBrowserClient;
