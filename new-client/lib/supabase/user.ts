import { supabaseServer } from "@/lib/supabase/server";
import type { UserIdentity } from "@/components/user-identity-provider";

export async function getCurrentUserIdServer() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error && error.message !== "Auth session missing!") {
    throw new Error(`Failed to get current user: ${error.message}`);
  }

  return data?.user?.id ?? null;
}

export async function requireUserIdServer() {
  const userId = await getCurrentUserIdServer();
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

export async function getCurrentUserIdClient() {
  const { default: supabaseClient } = await import("@/lib/supabase/browser-client");
  const { data, error } = await supabaseClient.auth.getUser();
  if (error && error.message !== "Auth session missing!") {
    throw new Error(`Failed to get current user (client): ${error.message}`);
  }
  return data?.user?.id ?? null;
}

export async function getCurrentUserIdentity(): Promise<UserIdentity> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;

  const fullName =
    (user?.user_metadata as any)?.full_name ||
    (user?.user_metadata as any)?.name ||
    null;
  const email = user?.email ?? null;

  if (!user?.id) {
    return {
      userId: null,
      fullName: null,
      email: null,
      isGuest: true,
    };
  }

  return {
    userId: user.id,
    fullName,
    email,
    isGuest: false,
  };
}
