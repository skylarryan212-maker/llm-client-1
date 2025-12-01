"use server";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_AUTH_STORAGE_KEY } from "@/lib/supabase/constants";
import type { Database } from "./types";

export async function supabaseServer() {
  // Turbopack RSC / Next versions may make `cookies()` async. Call it and
  // await if it returns a Promise; otherwise use the value directly. If
  // cookies are unavailable, degrade to stateless behavior.
  let cookieStore: Awaited<ReturnType<typeof cookies>> | null = null;
  try {
    const maybe = cookies();
    if (maybe && typeof (maybe as any).then === "function") {
      cookieStore = await (maybe as Promise<ReturnType<typeof cookies>>);
    } else {
      cookieStore = maybe as Awaited<ReturnType<typeof cookies>>;
    }
  } catch {
    cookieStore = null;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are not set");
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { storageKey: SUPABASE_AUTH_STORAGE_KEY },
    cookies: {
      get(name: string) {
        if (!cookieStore || typeof (cookieStore as any).get !== "function") {
          return undefined;
        }
        try {
          return (cookieStore as any).get(name)?.value;
        } catch {
          return undefined;
        }
      },
      set(name: string, value: string, options: any) {
        if (!cookieStore || typeof (cookieStore as any).set !== "function") {
          return;
        }
        try {
          (cookieStore as any).set({ name, value, ...options });
        } catch {
          // noop if cookies are read-only in this context
        }
      },
      remove(name: string, options: any) {
        if (!cookieStore || typeof (cookieStore as any).set !== "function") {
          return;
        }
        try {
          (cookieStore as any).set({ name, value: "", ...options });
        } catch {
          // noop if cookies are read-only in this context
        }
      },
    },
  });
}
