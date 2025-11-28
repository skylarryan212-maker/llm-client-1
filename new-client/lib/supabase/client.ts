"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Simple client-side supabase instance for realtime subscriptions and client fetches.
// Uses NEXT_PUBLIC_* env variables that are available in the browser.
export const supabaseClient = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
);

export default supabaseClient;
