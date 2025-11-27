"use client";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export function supabaseBrowser() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
