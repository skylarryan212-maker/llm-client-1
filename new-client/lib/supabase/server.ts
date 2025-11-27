import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./types";

export const supabaseServer = (cookieStore: ReturnType<typeof cookies>) =>
  createSupabaseServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieStore }
  );

export function createServerClient() {
  const cookieStore = cookies();
  return supabaseServer(cookieStore);
}
