import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import type { Database } from "@/lib/supabase/types";

type SupabaseClient = any;

export const GUEST_SESSION_COOKIE = "guest_session_id";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
export const GUEST_PROMPT_LIMIT_PER_DAY = 30;

type GuestSessionRow = Database["public"]["Tables"]["guest_sessions"]["Row"];

const startOfUtcDay = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

async function createGuestSessionRecord(
  supabase: SupabaseClient,
  id: string
): Promise<GuestSessionRow | null> {
  const { data, error } = await (supabase as any)
    .from("guest_sessions")
    .insert({ id })
    .select()
    .single();
  if (error) {
    console.error("[guestSession] Failed to create guest session:", error);
    return null;
  }
  return data as GuestSessionRow;
}

export async function ensureGuestSession(
  request: NextRequest,
  supabase: SupabaseClient
): Promise<{
  session: GuestSessionRow;
  cookieValue?: string;
}> {
  let sessionId = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  let newlyIssuedCookie: string | undefined;

  if (!sessionId) {
    sessionId = randomUUID();
    newlyIssuedCookie = sessionId;
  }

  const { data: sessionData, error } = await (supabase as any)
    .from("guest_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  let session = sessionData as GuestSessionRow | null;

  if (error) {
    console.error("[guestSession] Failed to load session:", error);
  }

  if (!session) {
    const created = await createGuestSessionRecord(supabase, sessionId!);
    if (!created) {
      throw new Error("Unable to create guest session");
    }
    session = created;
  }

  return { session: session as GuestSessionRow, cookieValue: newlyIssuedCookie };
}

export async function incrementGuestSessionRequest(
  supabase: SupabaseClient,
  sessionId: string,
  newCount: number
) {
  const nowIso = new Date().toISOString();
  const { error } = await (supabase as any)
    .from("guest_sessions")
    .update({
      request_count: newCount,
      last_seen: nowIso,
    })
    .eq("id", sessionId);

  if (error) {
    console.error("[guestSession] Failed to update session:", error);
  }
}

export async function addGuestUsage(
  supabase: SupabaseClient,
  sessionId: string,
  currentTokenCount: number | null | undefined,
  currentEstimatedCost: number | null | undefined,
  tokenDelta: number,
  costDelta: number
) {
  if (!tokenDelta && !costDelta) return;
  const nowIso = new Date().toISOString();
  const newTokenCount = (currentTokenCount ?? 0) + Math.max(0, tokenDelta);
  const newEstimatedCost = (currentEstimatedCost ?? 0) + Math.max(0, costDelta);
  const { error } = await (supabase as any)
    .from("guest_sessions")
    .update({
      token_count: newTokenCount,
      estimated_cost: newEstimatedCost,
      last_seen: nowIso,
    })
    .eq("id", sessionId);

  if (error) {
    console.error("[guestSession] Failed to record guest usage:", error);
  }
}
export function attachGuestCookie(response: NextResponse, value?: string) {
  if (!value) return;
  response.cookies.set(GUEST_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export function shouldResetDailyCounter(session: GuestSessionRow) {
  if (!session.last_seen) return true;
  return new Date(session.last_seen) < startOfUtcDay();
}
