import { NextRequest, NextResponse } from "next/server";

import { loadSgaInstance, loadSgaInstanceAdmin } from "@/lib/data/sga";
import { supabaseServer, supabaseServerAdmin } from "@/lib/supabase/server";
import { requireUserIdServer } from "@/lib/supabase/user";
import type { SgaConnection } from "@/lib/types/sga";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_PREVIEW_CHARS = 2000;
const MAX_DETAIL_LOGS = 75;

function truncate(value: string, max = MAX_PREVIEW_CHARS) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim();
}

function patternMatches(value: string, pattern: string) {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (trimmed === "*") return true;
  if (trimmed.includes("*")) {
    const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`, "i");
    return regex.test(value);
  }
  return value.includes(trimmed);
}

function isEndpointAllowed(endpoint: string, allowList: string[], denyList: string[]) {
  if (denyList.some((pattern) => patternMatches(endpoint, pattern))) {
    return false;
  }
  if (allowList.length === 0) return true;
  return allowList.some((pattern) => patternMatches(endpoint, pattern));
}

function resolveEndpointUrl(connection: SgaConnection, endpoint: string) {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  if (!connection.baseUrl) return null;
  const base = connection.baseUrl.replace(/\/+$/, "");
  const path = endpoint.replace(/^\/+/, "");
  return `${base}/${path}`;
}

function buildAuthHeader(connection: SgaConnection) {
  if (!connection.authType || connection.authType === "none" || !connection.authValue) {
    return null;
  }
  const headerName =
    connection.authHeader?.trim() ||
    (connection.authType === "api_key" ? "x-api-key" : "Authorization");
  if (connection.authType === "api_key") {
    return { name: headerName, value: connection.authValue };
  }
  if (connection.authType === "basic") {
    return { name: headerName, value: `Basic ${connection.authValue}` };
  }
  return { name: headerName, value: `Bearer ${connection.authValue}` };
}

function stripQuery(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return trimmed.split("?")[0]?.split("#")[0] ?? trimmed;
  }
}

async function fetchEndpoint(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    let preview = "";
    try {
      if (contentType.includes("application/json")) {
        const json = await response.json();
        preview = truncate(JSON.stringify(json));
      } else {
        preview = truncate(await response.text());
      }
    } catch (error) {
      preview = "Unable to parse response body.";
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - start,
      preview,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - start,
      preview: truncate(message),
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> }
) {
  try {
    const cronSecret = request.headers.get("x-sga-cron");
    const isCron =
      !!cronSecret &&
      !!process.env.SGA_CRON_SECRET &&
      cronSecret === process.env.SGA_CRON_SECRET;
    if (!isCron) {
      await requireUserIdServer();
    }
    const { instanceId } = await params;
    if (!instanceId) {
      return NextResponse.json({ error: "Invalid instance id" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      trigger?: string;
      stage?: string;
    };
    const trigger = body?.trigger === "schedule" ? "schedule" : "manual";
    const stage = body?.stage === "schedule_only" ? "schedule_only" : "run";

    const instance = isCron
      ? await loadSgaInstanceAdmin(instanceId, { includeSecrets: true })
      : await loadSgaInstance(instanceId, { includeSecrets: true });
    if (!instance) {
      return NextResponse.json({ error: "SGA instance not found" }, { status: 404 });
    }

    const supabase = await supabaseServer();
    const supabaseAny = supabase as any;
    let supabaseWrite: any = supabaseAny;
    try {
      supabaseWrite = await supabaseServerAdmin();
    } catch {
      // Fall back to user-scoped client when admin credentials are unavailable.
    }
    const runStartedAt = new Date().toISOString();
    const cycleId = `cycle-${Date.now()}`;

    if (stage === "schedule_only") {
      const { data: waitingRow, error: waitingError } = await supabaseWrite
        .from("governor_runs")
        .insert([
          {
            instance_id: instanceId,
            status: "waiting",
            cycle_id: cycleId,
            mode: trigger === "manual" ? "MANUAL" : "NORMAL",
            current_phase: 0,
            phase_data: {
              phase: "scheduler",
              phase_index: 0,
              trigger,
              ts_start: runStartedAt,
            },
            created_at: runStartedAt,
            updated_at: runStartedAt,
          },
        ])
        .select("*")
        .maybeSingle();

      if (waitingError || !waitingRow) {
        throw new Error(waitingError?.message ?? "Failed to schedule run");
      }

      return NextResponse.json({ ok: true, run: waitingRow });
    }

    const { error: phaseZeroError } = await supabaseWrite
      .from("governor_runs")
      .insert([
        {
          instance_id: instanceId,
          status: "completed",
          cycle_id: cycleId,
          mode: trigger === "manual" ? "MANUAL" : "NORMAL",
          current_phase: 0,
          phase_data: {
            phase: "scheduler",
            phase_index: 0,
            trigger,
            ts_start: runStartedAt,
            ts_end: runStartedAt,
          },
          created_at: runStartedAt,
          updated_at: runStartedAt,
        },
      ]);

    if (phaseZeroError) {
      throw new Error(phaseZeroError.message ?? "Failed to record scheduler completion");
    }

    const { data: runningRow, error: runningError } = await supabaseWrite
      .from("governor_runs")
      .insert([
        {
          instance_id: instanceId,
          status: "running",
          cycle_id: cycleId,
          mode: trigger === "manual" ? "MANUAL" : "NORMAL",
          current_phase: 1,
          phase_data: {
            phase: "observe",
            phase_index: 1,
            trigger,
            ts_start: runStartedAt,
          },
          created_at: runStartedAt,
          updated_at: runStartedAt,
        },
      ])
      .select("*")
      .maybeSingle();

    if (runningError || !runningRow) {
      throw new Error(runningError?.message ?? "Failed to start run");
    }

    const runId = runningRow.id;
    const logs: Array<{
      run_id: string;
      instance_id: string;
      log_type: string;
      severity: string;
      content: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }> = [];
    const addLog = (entry: Omit<(typeof logs)[number], "created_at">) => {
      logs.push({ ...entry, created_at: new Date().toISOString() });
    };

    addLog({
      run_id: runId,
      instance_id: instanceId,
      log_type: "cycle_trigger",
      severity: "info",
      content: `Cycle triggered via ${trigger}.`,
      metadata: { trigger, phase: 0 },
    });

    addLog({
      run_id: runId,
      instance_id: instanceId,
      log_type: "phase_start",
      severity: "info",
      content: "Phase 1 started (observe).",
      metadata: { trigger, phase: 1 },
    });
    const connections = instance.connections ?? [];
    const connectionReports: Array<Record<string, unknown>> = [];
    const errorSummaries: Array<Record<string, unknown>> = [];
    let endpointsChecked = 0;
    let failures = 0;

    for (const connection of connections) {
      if (!["read", "read_write", "custom"].includes(connection.permission)) {
        connectionReports.push({
          id: connection.id,
          name: connection.name,
          skipped: true,
          reason: "Read access disabled",
        });
        continue;
      }

      const endpoints = (connection.readEndpoints ?? []).map(normalizeEndpoint).filter(Boolean);
      if (!endpoints.length) {
        connectionReports.push({
          id: connection.id,
          name: connection.name,
          skipped: true,
          reason: "No read endpoints configured",
        });
        continue;
      }

      const allowedEndpoints = endpoints.filter((endpoint) =>
        isEndpointAllowed(endpoint, connection.allowList ?? [], connection.denyList ?? [])
      );

      if (!allowedEndpoints.length) {
        connectionReports.push({
          id: connection.id,
          name: connection.name,
          skipped: true,
          reason: "Allow/deny rules blocked all endpoints",
        });
        continue;
      }

      const baseHeaders: Record<string, string> = {
        Accept: "application/json",
        ...(connection.headers ?? {}),
      };
      const authHeader = buildAuthHeader(connection);
      if (authHeader) {
        baseHeaders[authHeader.name] = authHeader.value;
      }

      const endpointResults = [];
      for (const endpoint of allowedEndpoints) {
        const resolvedUrl = resolveEndpointUrl(connection, endpoint);
        if (!resolvedUrl) {
          failures += 1;
          endpointResults.push({
            endpoint,
            ok: false,
            status: null,
            durationMs: 0,
            preview: "Missing base URL.",
          });
          errorSummaries.push({
            connection: connection.name,
            endpoint,
            error: "Missing base URL",
          });
          continue;
        }

        const result = await fetchEndpoint(resolvedUrl, baseHeaders);
        endpointsChecked += 1;
        if (!result.ok) {
          failures += 1;
          errorSummaries.push({
            connection: connection.name,
            endpoint,
            status: result.status,
            error: result.preview,
          });
        }
        addLog({
          run_id: runId,
          instance_id: instanceId,
          log_type: "api_call",
          severity: result.ok ? "info" : "medium",
          content: `GET ${stripQuery(resolvedUrl)} -> ${result.status ?? "error"}`,
          metadata: {
            connection: connection.name,
            endpoint,
            url: stripQuery(resolvedUrl),
            ok: result.ok,
            status: result.status,
            durationMs: result.durationMs,
            preview: result.preview,
          },
        });
        endpointResults.push({
          endpoint,
          url: resolvedUrl,
          ok: result.ok,
          status: result.status,
          durationMs: result.durationMs,
          preview: result.preview,
        });
      }

      connectionReports.push({
        id: connection.id,
        name: connection.name,
        endpoints: endpointResults,
      });
    }

    const runFinishedAt = new Date().toISOString();
    const summary = `Observed ${connectionReports.length} connections / ${endpointsChecked} endpoints with ${failures} failures.`;
    const severity = failures > 0 ? "medium" : "info";
    const riskRegister =
      failures > 0
        ? [
            {
              id: `risk-${cycleId}`,
              label: "Connector errors",
              level: failures > 3 ? "high" : "medium",
              note: `${failures} endpoint failures detected during the latest scan.`,
            },
          ]
        : [];

    const phaseData = {
      cycle_id: cycleId,
      ts_start: runStartedAt,
      ts_end: runFinishedAt,
      mode: trigger === "manual" ? "MANUAL" : "NORMAL",
      phase: "observe",
      phase_index: 1,
      currentObjective: instance.primaryObjective,
      constraints: ["Observe-only mode: read-only API access."],
      riskRegister,
      capabilitiesSummary: connections.map((connection) => ({
        id: connection.id,
        displayName: connection.name,
        kind: "data_source",
        domainTags: [],
        riskLevel: "low",
      })),
      openTasks: [],
      budgets: {
        dailyTimeBudgetHours: instance.dailyTimeBudgetHours,
        dailyCostBudgetUsd: instance.dailyCostBudgetUsd,
        todayEstimatedSpendUsd: instance.todayEstimatedSpendUsd,
      },
      observation: {
        trigger,
        summary,
        connectionsChecked: connectionReports.length,
        endpointsChecked,
        failures,
        results: connectionReports,
      },
    };

    const { data: completedRow, error: completedError } = await supabaseWrite
      .from("governor_runs")
      .insert([
        {
          instance_id: instanceId,
          status: "completed",
          cycle_id: cycleId,
          mode: trigger === "manual" ? "MANUAL" : "NORMAL",
          current_phase: 1,
          phase_data: phaseData,
          created_at: runFinishedAt,
          updated_at: runFinishedAt,
        },
      ])
      .select("*")
      .maybeSingle();

    if (completedError || !completedRow) {
      throw new Error(completedError?.message ?? "Failed to record run completion");
    }

    const { data: existingInstance } = await supabaseAny
      .from("governor_instances")
      .select("config")
      .eq("id", instanceId)
      .maybeSingle();
    const existingConfig =
      existingInstance && typeof existingInstance.config === "object" && existingInstance.config !== null
        ? existingInstance.config
        : {};
    await supabaseWrite
      .from("governor_instances")
      .update({
        config: { ...existingConfig, last_cycle_at: runFinishedAt, last_decision_at: runFinishedAt },
        updated_at: runFinishedAt,
      })
      .eq("id", instanceId);

    addLog({
      run_id: completedRow.id,
      instance_id: instanceId,
      log_type: "phase_complete",
      severity,
      content: `Phase 1 completed. ${summary}`,
      metadata: {
        trigger,
        phase: 1,
        connectionsChecked: connectionReports.length,
        endpointsChecked,
        failures,
      },
    });

    if (errorSummaries.length > 0) {
      addLog({
        run_id: completedRow.id,
        instance_id: instanceId,
        log_type: "error",
        severity: failures > 3 ? "high" : "medium",
        content: "Connector errors detected during observation.",
        metadata: {
          trigger,
          errors: errorSummaries.slice(0, 10),
        },
      });
    }

    if (logs.length > 0) {
      await supabaseWrite.from("governor_logs").insert(logs);
    }

    const waitingStartedAt = new Date().toISOString();
    await supabaseWrite
      .from("governor_runs")
      .insert([
        {
          instance_id: instanceId,
          status: "waiting",
          cycle_id: `cycle-${Date.now() + 1}`,
          mode: "NORMAL",
          current_phase: 0,
          phase_data: {
            phase: "scheduler",
            phase_index: 0,
            trigger: "schedule",
            ts_start: waitingStartedAt,
          },
          created_at: waitingStartedAt,
          updated_at: waitingStartedAt,
        },
      ]);

    const worldStatePayload = {
      instanceId,
      lastUpdatedAt: runFinishedAt,
      currentObjective: instance.primaryObjective,
      constraints: phaseData.constraints,
      riskRegister,
      capabilitiesSummary: phaseData.capabilitiesSummary,
      openTasks: [],
      budgets: phaseData.budgets,
    };

    const eventPayload = {
      id: completedRow.id,
      instanceId,
      kind: "situation_scan",
      createdAt: runFinishedAt,
      title: "Observation cycle",
      summary,
      severity,
    };
    const eventsPayload = [eventPayload, ...detailEvents];

    return NextResponse.json({
      ok: true,
      runId,
      summary,
      stats: {
        connectionsChecked: connectionReports.length,
        endpointsChecked,
        failures,
      },
      worldState: worldStatePayload,
      event: eventPayload,
      events: eventsPayload,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run SGA cycle";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
