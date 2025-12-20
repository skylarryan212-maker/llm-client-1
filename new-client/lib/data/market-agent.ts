import { supabaseServer, supabaseServerAdmin } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { Database, Json } from "@/lib/supabase/types";

type MarketAgentInstanceRow = Database["public"]["Tables"]["market_agent_instances"]["Row"];
type MarketAgentEventRow = Database["public"]["Tables"]["market_agent_events"]["Row"];
type MarketAgentStateRow = Database["public"]["Tables"]["market_agent_state"]["Row"];
type MarketAgentThesisRow = Database["public"]["Tables"]["market_agent_thesis"]["Row"];
type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];
type MessageRow = Database["public"]["Tables"]["messages"]["Row"];

const ALLOWED_CADENCES = new Set([60, 120, 300, 600, 1800, 3600]);
export type MarketAgentReportDepth = "short" | "standard" | "deep";
const ALLOWED_REPORT_DEPTH = new Set<MarketAgentReportDepth>(["short", "standard", "deep"]);
const ALLOWED_STATUSES = new Set(["draft", "running", "paused"] as const);

function isValidUuid(id?: string | null) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function getAdminClient() {
  try {
    return await supabaseServerAdmin();
  } catch {
    return null;
  }
}

export type MarketAgentInstanceWithWatchlist = MarketAgentInstanceRow & {
  watchlist: string[];
};

export type MarketAgentFeedEvent = MarketAgentEventRow & {
  instance?: MarketAgentInstanceWithWatchlist;
};

export type MarketAgentThesis = MarketAgentThesisRow;

export type MarketAgentMessageRow = MessageRow & { metadata?: Json | null };
export type MarketAgentChatMessage = {
  id: string;
  role: "user" | "agent" | "system" | "assistant";
  content: string;
  created_at: string | null;
  metadata: Json | null;
};

export async function listMarketAgentInstances(): Promise<MarketAgentInstanceWithWatchlist[]> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const { data: instances, error } = await supabaseAny
    .from("market_agent_instances")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load market agent instances: ${error.message}`);
  }

  const instanceIds = (instances ?? []).map((i: any) => i.id);
  if (!instanceIds.length) {
    return [];
  }

  const { data: watchlistRows, error: watchlistError } = await supabaseAny
    .from("market_agent_watchlist_items")
    .select("instance_id, symbol")
    .in("instance_id", instanceIds);

  if (watchlistError) {
    throw new Error(`Failed to load watchlist items: ${watchlistError.message}`);
  }

  const grouped = new Map<string, string[]>();
  (watchlistRows ?? []).forEach((row: any) => {
    if (!row?.instance_id || !row?.symbol) return;
    const list = grouped.get(row.instance_id) ?? [];
    list.push(row.symbol);
    grouped.set(row.instance_id, list);
  });

  return (instances ?? []).map((instance: any) => ({
    ...(instance as MarketAgentInstanceRow),
    watchlist: grouped.get(instance.id) ?? [],
  }));
}

export async function getMarketAgentInstance(
  instanceId: string,
  providedUserId?: string | null
): Promise<MarketAgentInstanceWithWatchlist | null> {
  if (!isValidUuid(instanceId)) return null;
  const userId = providedUserId ?? (await requireUserIdServer());
  const admin = await getAdminClient();
  const supabase = await supabaseServer();
  const supabaseClient: any = supabase as any;

  let instance: MarketAgentInstanceRow | null = null;
  let instanceClient: any = supabaseClient;

  // First try with the RLS-scoped client
  const { data: rlsInstance, error: rlsError } = await supabaseClient
    .from("market_agent_instances")
    .select("*")
    .eq("id", instanceId)
    .maybeSingle();

  if (rlsError) {
    throw new Error(`Failed to load market agent instance: ${rlsError.message}`);
  }

  if (rlsInstance && rlsInstance.user_id === userId) {
    instance = rlsInstance as MarketAgentInstanceRow;
  }

  // Fallback to admin client (still enforce ownership) in case RLS/session blocks read
  if (!instance && admin) {
    const { data: adminInstance, error: adminError } = await (admin as any)
      .from("market_agent_instances")
      .select("*")
      .eq("id", instanceId)
      .maybeSingle();

    if (adminError) {
      throw new Error(`Failed to load market agent instance: ${adminError.message}`);
    }

    if (adminInstance && adminInstance.user_id === userId) {
      instance = adminInstance as MarketAgentInstanceRow;
      instanceClient = admin as any;
    }
  }

  if (!instance || instance.user_id !== userId) return null;

  const { data: watchlistRows } = await instanceClient
    .from("market_agent_watchlist_items")
    .select("symbol")
    .eq("instance_id", instanceId);

  return {
    ...instance,
    watchlist: (watchlistRows ?? []).map((row: any) => row.symbol).filter(Boolean),
  };
}

export async function getMarketAgentState(instanceId: string): Promise<MarketAgentStateRow | null> {
  if (!isValidUuid(instanceId)) return null;
  const userId = await requireUserIdServer();
  const ownerInstance = await getMarketAgentInstance(instanceId, userId);
  if (!ownerInstance) return null;

  const admin = await getAdminClient();
  const supabase = await supabaseServer();
  const client: any = admin ?? (supabase as any);

  const { data, error } = await client
    .from("market_agent_state")
    .select("*")
    .eq("instance_id", instanceId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load market agent state: ${error.message}`);
  }

  return data ?? null;
}

export async function getMarketAgentEvents(params: {
  instanceId: string;
  limit?: number;
  beforeCreatedAt?: string;
}): Promise<MarketAgentEventRow[]> {
  const userId = await requireUserIdServer();
  const ownerInstance = await getMarketAgentInstance(params.instanceId, userId);
  if (!ownerInstance) return [];

  const admin = await getAdminClient();
  const supabase = await supabaseServer();
  const client: any = admin ?? (supabase as any);

  let query = client
    .from("market_agent_events")
    .select("*")
    .eq("instance_id", params.instanceId)
    .order("created_at", { ascending: false })
    .order("ts", { ascending: false, nullsLast: true });

  if (params.beforeCreatedAt) {
    query = query.lt("created_at", params.beforeCreatedAt);
  }

  if (params.limit) {
    query = query.limit(params.limit);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to load market agent events: ${error.message}`);
  }

  return data ?? [];
}

export async function getMarketAgentThesis(instanceId: string): Promise<MarketAgentThesisRow | null> {
  if (!isValidUuid(instanceId)) return null;
  const userId = await requireUserIdServer();
  const ownerInstance = await getMarketAgentInstance(instanceId, userId);
  if (!ownerInstance) return null;

  const admin = await getAdminClient();
  const supabase = await supabaseServer();
  const client: any = admin ?? (supabase as any);

  const { data, error } = await client
    .from("market_agent_thesis")
    .select("*")
    .eq("instance_id", instanceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load market agent thesis: ${error.message}`);
  }

  return data ?? null;
}

export async function upsertMarketAgentThesis(params: {
  instanceId: string;
  bias?: string | null;
  watched?: string[];
  key_levels?: Json;
  invalidation?: string | null;
  next_check?: string | null;
}) {
  if (!isValidUuid(params.instanceId)) {
    throw new Error("Invalid instance id");
  }
  const userId = await requireUserIdServer();
  const ownerInstance = await getMarketAgentInstance(params.instanceId, userId);
  if (!ownerInstance) {
    throw new Error("Instance not found or not owned");
  }
  const supabase = await supabaseServer();
  const supabaseAny = supabase as any;

  const { error } = await supabaseAny
    .from("market_agent_thesis")
    .upsert([
      {
        instance_id: params.instanceId,
        bias: params.bias ?? null,
        watched: params.watched ?? [],
        key_levels: params.key_levels ?? {},
        invalidation: params.invalidation ?? null,
        next_check: params.next_check ?? null,
        updated_at: new Date().toISOString(),
      },
    ])
    .eq("instance_id", params.instanceId);

  if (error) {
    throw new Error(`Failed to upsert thesis: ${error.message}`);
  }
}

export async function createMarketAgentEvent(params: {
  instanceId: string;
  kind?: string | null;
  title?: string | null;
  summary?: string | null;
  bodyMd?: string | null;
  severityLabel?: string | null;
  tickers?: string[];
  createdAt?: string;
}): Promise<MarketAgentEventRow> {
  if (!isValidUuid(params.instanceId)) {
    throw new Error("Invalid instance id");
  }
  const userId = await requireUserIdServer();
  const ownerInstance = await getMarketAgentInstance(params.instanceId, userId);
  if (!ownerInstance) {
    throw new Error("Instance not found or not owned");
  }
  const supabase = await supabaseServer();
  const supabaseAny = supabase as any;
  const now = params.createdAt ?? new Date().toISOString();

  const { data, error } = await supabaseAny
    .from("market_agent_events")
    .insert([
      {
        instance_id: params.instanceId,
        event_type: params.kind ?? "report",
        severity: "info",
        summary: params.summary ?? "",
        payload: {},
        model_used: null,
        kind: params.kind ?? "report",
        title: params.title ?? "",
        body_md: params.bodyMd ?? "",
        tickers: params.tickers ?? [],
        severity_label: params.severityLabel ?? null,
        created_at: now,
        ts: now,
      },
    ])
    .select()
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to create market agent event: ${error?.message ?? "Unknown error"}`);
  }

  return data as MarketAgentEventRow;
}

export async function getLatestMarketAgentEvents(limit = 10): Promise<MarketAgentEventRow[]> {
  const admin = await getAdminClient();
  const supabase = await supabaseServer();
  const client: any = admin ?? (supabase as any);
  await requireUserIdServer();

  const { data, error } = await client
    .from("market_agent_events")
    .select("*")
    .order("ts", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load recent market agent events: ${error.message}`);
  }

  return data ?? [];
}

export async function getMarketAgentFeed(params?: {
  instanceId?: string | null;
  limit?: number;
}): Promise<{
  events: MarketAgentFeedEvent[];
  instances: MarketAgentInstanceWithWatchlist[];
}> {
  const admin = await getAdminClient();
  const supabase = await supabaseServer();
  const client: any = admin ?? (supabase as any);
  await requireUserIdServer();

  const eventLimit = params?.limit && params.limit > 0 ? params.limit : 15;

  // Instances still come from RLS-scoped list to respect ownership
  const instances = await listMarketAgentInstances();
  const instanceMap = new Map(instances.map((inst) => [inst.id, inst] as const));
  const instanceIds = instances.map((inst) => inst.id);

  if (!instanceIds.length) {
    return { events: [], instances: [] };
  }

  let eventsQuery = client
    .from("market_agent_events")
    .select("*")
    .in("instance_id", instanceIds)
    .order("ts", { ascending: false })
    .limit(eventLimit);

  if (params?.instanceId) {
    eventsQuery = eventsQuery.eq("instance_id", params.instanceId);
  }

  const { data: events, error } = await eventsQuery;
  if (error) {
    throw new Error(`Failed to load market agent feed: ${error.message}`);
  }

  const feedEvents: MarketAgentFeedEvent[] = (events ?? []).map((evt: any) => ({
    ...(evt as MarketAgentEventRow),
    instance: instanceMap.get(evt.instance_id),
  }));

  return { events: feedEvents, instances };
}

export async function createMarketAgentInstance(params: {
  label?: string | null;
  cadenceSeconds: number;
  watchlist: string[];
  config?: Json;
  status?: "draft" | "running" | "paused";
}): Promise<MarketAgentInstanceWithWatchlist> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;
  const cadence = ALLOWED_CADENCES.has(params.cadenceSeconds)
    ? params.cadenceSeconds
    : 300;
  const status = ALLOWED_STATUSES.has(params.status ?? "draft")
    ? params.status
    : "draft";
  const configRecord = (params.config ?? {}) as Record<string, unknown>;
  const requestedDepth =
    typeof configRecord.report_depth === "string" && ALLOWED_REPORT_DEPTH.has(configRecord.report_depth as MarketAgentReportDepth)
      ? (configRecord.report_depth as MarketAgentReportDepth)
      : null;
  const reportDepth = requestedDepth ?? "standard";

  const { data: instance, error } = await supabaseAny
    .from("market_agent_instances")
    .insert([
      {
        user_id: userId,
        label: params.label ?? "Market Agent",
        cadence_seconds: cadence,
        status,
        report_depth: reportDepth,
        config: params.config ?? {},
      },
    ])
    .select()
    .maybeSingle();

  if (error || !instance) {
    throw new Error(`Failed to create market agent instance: ${error?.message ?? "Unknown error"}`);
  }

  const watchlistSymbols = (params.watchlist || []).map((s) => s.trim()).filter(Boolean);
  if (watchlistSymbols.length) {
    const watchlistRows = watchlistSymbols.map((symbol) => ({
      instance_id: instance.id,
      symbol,
    }));
    const { error: watchlistError } = await supabaseAny
      .from("market_agent_watchlist_items")
      .insert(watchlistRows);
    if (watchlistError) {
      throw new Error(`Failed to add watchlist items: ${watchlistError.message}`);
    }
  }

  // Initialize empty state
  const { error: stateError } = await supabaseAny
    .from("market_agent_state")
    .upsert([
      {
        instance_id: instance.id,
        state: {},
        state_version: 1,
      },
    ]);

  if (stateError) {
    throw new Error(`Failed to initialize agent state: ${stateError.message}`);
  }

  return {
    ...(instance as MarketAgentInstanceRow),
    watchlist: watchlistSymbols,
  };
}

export async function updateMarketAgentStatus(instanceId: string, status: "draft" | "running" | "paused") {
  if (!ALLOWED_STATUSES.has(status) || !isValidUuid(instanceId)) return;
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const { error } = await supabaseAny
    .from("market_agent_instances")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to update agent status: ${error.message}`);
  }
}

export async function deleteMarketAgentInstance(instanceId: string) {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const { error } = await supabaseAny
    .from("market_agent_instances")
    .delete()
    .eq("id", instanceId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete market agent instance: ${error.message}`);
  }
}

export async function insertMarketAgentEvent(params: {
  instanceId: string;
  eventType: string;
  severity?: "info" | "important" | "critical";
  summary?: string;
  payload?: Json;
  modelUsed?: string | null;
  ts?: string;
}): Promise<MarketAgentEventRow> {
  const supabase = await supabaseServer();
  await requireUserIdServer();

  const { data, error } = await supabase.rpc("insert_market_agent_event", {
    _instance_id: params.instanceId,
    _event_type: params.eventType,
    _severity: params.severity ?? "info",
    _summary: params.summary ?? "",
    _payload: params.payload ?? {},
    _model_used: params.modelUsed ?? null,
    _ts: params.ts ?? null,
  });

  if (error) {
    throw new Error(`Failed to insert market agent event: ${error.message}`);
  }

  return (data as MarketAgentEventRow) ?? ({} as MarketAgentEventRow);
}

export async function upsertMarketAgentState(params: {
  instanceId: string;
  state: Json;
  stateVersion?: number;
}) {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const { error } = await supabaseAny
    .from("market_agent_state")
    .upsert([
      {
        instance_id: params.instanceId,
        state: params.state ?? {},
        state_version: params.stateVersion ?? 1,
        updated_at: new Date().toISOString(),
      },
    ])
    .eq("instance_id", params.instanceId);

  if (error) {
    throw new Error(`Failed to update agent state: ${error.message}`);
  }

  // Touch instance updated_at to surface freshness
  const { error: updateError } = await supabaseAny
    .from("market_agent_instances")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.instanceId)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(`Failed to bump instance timestamp: ${updateError.message}`);
  }
}

export async function findMarketAgentConversation(instanceId: string): Promise<ConversationRow | null> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const { data, error } = await supabaseAny
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .eq("metadata->>agent", "market-agent")
    .eq("metadata->>market_agent_instance_id", instanceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    // If there are no rows, maybeSingle returns null data without throwing; treat other errors as fatal.
    if (String(error.code || "").startsWith("PGRST") || error.message?.includes("Results contain 0 rows")) {
      return null;
    }
    throw new Error(`Failed to lookup market agent conversation: ${error.message}`);
  }

  return data ?? null;
}

export async function ensureMarketAgentConversation(instanceId: string): Promise<ConversationRow> {
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const existing = await findMarketAgentConversation(instanceId);
  if (existing) return existing;

  const metadata = {
    agent: "market-agent",
    agent_type: "market_agent",
    market_agent_instance_id: instanceId,
    agent_chat: true,
  };

  const { data, error } = await supabaseAny
    .from("conversations")
    .insert([
      {
        user_id: userId,
        title: "Market Agent",
        project_id: null,
        metadata,
      },
    ])
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create market agent conversation: ${error?.message ?? "Unknown error"}`);
  }

  return data as ConversationRow;
}

export async function listMarketAgentMessages(instanceId: string, limit = 100): Promise<MarketAgentChatMessage[]> {
  if (!isValidUuid(instanceId)) return [];
  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const conversation = await ensureMarketAgentConversation(instanceId);

  const { data, error } = await supabaseAny
    .from("messages")
    .select("*")
    .eq("conversation_id", conversation.id)
    .eq("user_id", userId)
    .eq("metadata->>agent", "market-agent")
    .eq("metadata->>market_agent_instance_id", instanceId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load agent chat messages: ${error.message}`);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    role: (row.role as MarketAgentChatMessage["role"]) ?? "user",
    content: row.content ?? "",
    created_at: row.created_at ?? null,
    metadata: (row as any).metadata ?? null,
  }));
}

export async function insertMarketAgentMessage(params: {
  instanceId: string;
  role: "user" | "agent" | "system";
  content: string;
}): Promise<MarketAgentChatMessage> {
  if (!isValidUuid(params.instanceId)) {
    throw new Error("Invalid instance id");
  }
  if (!["user", "agent", "system"].includes(params.role)) {
    throw new Error("Invalid role");
  }
  const content = (params.content ?? "").trim();
  if (!content.length) {
    throw new Error("Message content is required");
  }

  const supabase = await supabaseServer();
  const userId = await requireUserIdServer();
  const supabaseAny = supabase as any;

  const conversation = await ensureMarketAgentConversation(params.instanceId);
  const metadata = {
    agent: "market-agent",
    market_agent_instance_id: params.instanceId,
  };

  const { data, error } = await supabaseAny
    .from("messages")
    .insert([
      {
        user_id: userId,
        conversation_id: conversation.id,
        role: params.role,
        content,
        metadata,
      },
    ])
    .select()
    .maybeSingle();

  if (error || !data) {
    throw new Error(`Failed to insert chat message: ${error?.message ?? "Unknown error"}`);
  }

  return {
    id: data.id,
    role: (data.role as MarketAgentChatMessage["role"]) ?? params.role,
    content: data.content ?? content,
    created_at: data.created_at ?? null,
    metadata: (data as any).metadata ?? metadata,
  };
}
