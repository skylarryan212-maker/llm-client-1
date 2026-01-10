"use server";

import { redirect } from "next/navigation";
import { supabaseServer, supabaseServerAdmin } from "@/lib/supabase/server";

const ADMIN_SETTINGS_ID = "singleton";
const DEFAULT_RANGE_DAYS = 30;

type AdminSettingsRow = {
  admin_user_id: string;
  admin_email: string;
  created_at?: string | null;
};

type AdminGateResult =
  | {
      status: "unauthenticated";
    }
  | {
      status: "unclaimed";
      userId: string;
      email: string | null;
      isGoogleUser: boolean;
    }
  | {
      status: "forbidden";
      userId: string;
      email: string | null;
      adminEmail: string | null;
    }
  | {
      status: "admin";
      userId: string;
      email: string | null;
      adminEmail: string | null;
    };

type UsageTotals = {
  costUsd: number;
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
};

type UsageBreakdown = UsageTotals & {
  key: string;
  eventType: string;
  model: string;
  stage?: string | null;
  source?: string | null;
};

type StageBreakdown = UsageTotals & {
  stage: string;
};

type EventTypeBreakdown = UsageTotals & {
  eventType: string;
};

export type AdminUserUsage = {
  userId: string;
  email: string | null;
  lastActiveAt: string | null;
  totals: UsageTotals;
  breakdown: UsageBreakdown[];
  routerStages: StageBreakdown[];
  byEventType: EventTypeBreakdown[];
};

export type AdminUsageSummary = {
  rangeDays: number;
  totals: UsageTotals;
  users: AdminUserUsage[];
};

function coerceNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function emptyTotals(): UsageTotals {
  return { costUsd: 0, calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
}

function addTotals(target: UsageTotals, row: UsageTotals) {
  target.costUsd += row.costUsd;
  target.calls += row.calls;
  target.inputTokens += row.inputTokens;
  target.cachedTokens += row.cachedTokens;
  target.outputTokens += row.outputTokens;
}

async function loadAdminSettings(): Promise<AdminSettingsRow | null> {
  const admin = await supabaseServerAdmin();
  const { data, error } = await (admin as any)
    .from("admin_settings")
    .select("admin_user_id, admin_email, created_at")
    .eq("id", ADMIN_SETTINGS_ID)
    .maybeSingle();
  if (error) {
    console.error("[admin] Failed to load admin settings", error);
    return null;
  }
  return data ?? null;
}

export async function getAdminGate(): Promise<AdminGateResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error && error.message !== "Auth session missing!") {
    throw new Error(`Failed to get current user: ${error.message}`);
  }
  const user = data?.user;
  if (!user?.id) {
    return { status: "unauthenticated" };
  }

  const settings = await loadAdminSettings();
  const email = user.email ?? null;
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const provider =
    (user.app_metadata as any)?.provider ||
    (identities[0] as any)?.provider ||
    null;
  const isGoogleUser = identities.some((id: any) => id.provider === "google") || provider === "google";

  if (!settings?.admin_user_id) {
    return { status: "unclaimed", userId: user.id, email, isGoogleUser };
  }

  if (settings.admin_user_id !== user.id) {
    return {
      status: "forbidden",
      userId: user.id,
      email,
      adminEmail: settings.admin_email ?? null,
    };
  }

  return {
    status: "admin",
    userId: user.id,
    email,
    adminEmail: settings.admin_email ?? null,
  };
}

export async function claimAdminAccess() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user?.id) {
    redirect("/login?next=/admin");
  }

  const identities = Array.isArray(user.identities) ? user.identities : [];
  const provider =
    (user.app_metadata as any)?.provider ||
    (identities[0] as any)?.provider ||
    null;
  const isGoogleUser = identities.some((id: any) => id.provider === "google") || provider === "google";
  if (!isGoogleUser) {
    return { ok: false, error: "Admin access must be claimed with a Google account." };
  }

  const email = user.email ?? null;
  if (!email) {
    return { ok: false, error: "Your account does not have an email address." };
  }

  const existing = await loadAdminSettings();
  if (existing?.admin_user_id) {
    return { ok: false, error: "Admin access has already been claimed." };
  }

  const admin = await supabaseServerAdmin();
  const { data: inserted, error } = await (admin as any)
    .from("admin_settings")
    .insert({
      id: ADMIN_SETTINGS_ID,
      admin_user_id: user.id,
      admin_email: email,
    })
    .select("admin_user_id, admin_email")
    .single();

  if (error || !inserted) {
    console.error("[admin] Failed to claim admin access", error);
    return { ok: false, error: "Failed to claim admin access." };
  }

  return { ok: true, adminEmail: inserted.admin_email };
}

async function loadUserEmailMap() {
  const admin = await supabaseServerAdmin();
  const emailMap = new Map<string, string | null>();
  try {
    // @ts-ignore - admin typings may differ across SDK versions
    const listRes = await (admin.auth.admin as any).listUsers?.({ page: 1, perPage: 1000 });
    if (listRes && Array.isArray(listRes.users)) {
      listRes.users.forEach((user: any) => {
        if (user?.id) {
          emailMap.set(user.id, user.email ?? null);
        }
      });
    }
  } catch (err) {
    console.warn("[admin] Failed to list users for email mapping", err);
  }
  return emailMap;
}

export async function getAdminUsageSummary(rangeDays = DEFAULT_RANGE_DAYS): Promise<AdminUsageSummary> {
  const gate = await getAdminGate();
  if (gate.status !== "admin") {
    redirect("/login?next=/admin");
  }

  const admin = await supabaseServerAdmin();
  const sinceIso = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await (admin as any)
    .from("usage_events")
    .select("user_id,event_type,model,input_tokens,cached_tokens,output_tokens,cost_usd,metadata,created_at")
    .gte("created_at", sinceIso);
  if (error) {
    console.error("[admin] Failed to load usage events", error);
    return { rangeDays, totals: emptyTotals(), users: [] };
  }

  const emailMap = await loadUserEmailMap();
  const userMap = new Map<string, {
    usage: AdminUserUsage;
    breakdownMap: Map<string, UsageBreakdown>;
    stageMap: Map<string, StageBreakdown>;
    eventTypeMap: Map<string, EventTypeBreakdown>;
  }>();

  const globalTotals = emptyTotals();

  for (const row of data ?? []) {
    if (!row?.user_id) continue;
    const userId = String(row.user_id);
    const eventType = String(row.event_type ?? "unknown");
    const model = String(row.model ?? "unknown");
    const inputTokens = coerceNumber(row.input_tokens);
    const cachedTokens = coerceNumber(row.cached_tokens);
    const outputTokens = coerceNumber(row.output_tokens);
    const costUsd = coerceNumber(row.cost_usd);
    const metadata = typeof row.metadata === "string"
      ? (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })()
      : row.metadata ?? {};
    const stage = typeof metadata?.stage === "string" ? metadata.stage : null;
    const source = typeof metadata?.source === "string" ? metadata.source : null;
    const createdAt = row.created_at ? new Date(row.created_at).toISOString() : null;

    const totals = { costUsd, calls: 1, inputTokens, cachedTokens, outputTokens };
    addTotals(globalTotals, totals);

    let entry = userMap.get(userId);
    if (!entry) {
      const usage: AdminUserUsage = {
        userId,
        email: emailMap.get(userId) ?? null,
        lastActiveAt: createdAt,
        totals: emptyTotals(),
        breakdown: [],
        routerStages: [],
        byEventType: [],
      };
      entry = {
        usage,
        breakdownMap: new Map(),
        stageMap: new Map(),
        eventTypeMap: new Map(),
      };
      userMap.set(userId, entry);
    }

    if (!entry.usage.lastActiveAt || (createdAt && createdAt > entry.usage.lastActiveAt)) {
      entry.usage.lastActiveAt = createdAt;
    }

    addTotals(entry.usage.totals, totals);

    const breakdownKey = `${eventType}:${model}`;
    const existingBreakdown = entry.breakdownMap.get(breakdownKey);
    if (existingBreakdown) {
      addTotals(existingBreakdown, totals);
    } else {
      entry.breakdownMap.set(breakdownKey, {
        key: breakdownKey,
        eventType,
        model,
        stage,
        source,
        ...totals,
      });
    }

    if (eventType === "router" && stage) {
      const stageEntry = entry.stageMap.get(stage);
      if (stageEntry) {
        addTotals(stageEntry, totals);
      } else {
        entry.stageMap.set(stage, { stage, ...totals });
      }
    }

    const eventEntry = entry.eventTypeMap.get(eventType);
    if (eventEntry) {
      addTotals(eventEntry, totals);
    } else {
      entry.eventTypeMap.set(eventType, { eventType, ...totals });
    }
  }

  const users = Array.from(userMap.values()).map(({ usage, breakdownMap, stageMap, eventTypeMap }) => {
    const breakdown = Array.from(breakdownMap.values()).sort((a, b) => b.costUsd - a.costUsd);
    const routerStages = Array.from(stageMap.values()).sort((a, b) => b.costUsd - a.costUsd);
    const byEventType = Array.from(eventTypeMap.values()).sort((a, b) => b.costUsd - a.costUsd);
    return { ...usage, breakdown, routerStages, byEventType };
  }).sort((a, b) => b.totals.costUsd - a.totals.costUsd);

  return {
    rangeDays,
    totals: globalTotals,
    users,
  };
}
