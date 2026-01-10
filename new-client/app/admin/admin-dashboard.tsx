"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { AdminUsageSummary, AdminUserUsage } from "@/app/actions/admin-actions";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});

const numberFmt = new Intl.NumberFormat("en-US");

const formatTokens = (value: number) => numberFmt.format(Math.round(value));

const formatCost = (value: number) => currency.format(value);

const formatDateTime = (iso: string | null) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

function TotalsCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-400">{label}</p>
      <p className="text-2xl font-semibold text-white">{value}</p>
      {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

function BreakdownTable({ rows }: { rows: AdminUserUsage["breakdown"] }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-400">No usage recorded in this range.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="min-w-full text-sm">
        <thead className="bg-white/5 text-slate-300">
          <tr>
            <th className="px-3 py-2 text-left">Event</th>
            <th className="px-3 py-2 text-left">Model</th>
            <th className="px-3 py-2 text-right">Calls</th>
            <th className="px-3 py-2 text-right">Input</th>
            <th className="px-3 py-2 text-right">Cached</th>
            <th className="px-3 py-2 text-right">Output</th>
            <th className="px-3 py-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-white/5">
              <td className="px-3 py-2 text-slate-200">{row.eventType}</td>
              <td className="px-3 py-2 text-slate-200">
                <div className="space-y-1">
                  <div>{row.model}</div>
                  {row.stage ? (
                    <div className="text-xs text-slate-400">stage: {row.stage}</div>
                  ) : null}
                  {row.source ? (
                    <div className="text-xs text-slate-400">source: {row.source}</div>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2 text-right text-slate-200">{numberFmt.format(row.calls)}</td>
              <td className="px-3 py-2 text-right text-slate-200">{formatTokens(row.inputTokens)}</td>
              <td className="px-3 py-2 text-right text-slate-200">{formatTokens(row.cachedTokens)}</td>
              <td className="px-3 py-2 text-right text-slate-200">{formatTokens(row.outputTokens)}</td>
              <td className="px-3 py-2 text-right text-slate-200">{formatCost(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StageTable({ rows }: { rows: AdminUserUsage["routerStages"] }) {
  if (!rows.length) {
    return <p className="text-sm text-slate-400">No router usage recorded.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="min-w-full text-sm">
        <thead className="bg-white/5 text-slate-300">
          <tr>
            <th className="px-3 py-2 text-left">Router stage</th>
            <th className="px-3 py-2 text-right">Calls</th>
            <th className="px-3 py-2 text-right">Input</th>
            <th className="px-3 py-2 text-right">Output</th>
            <th className="px-3 py-2 text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.stage} className="border-t border-white/5">
              <td className="px-3 py-2 text-slate-200">{row.stage}</td>
              <td className="px-3 py-2 text-right text-slate-200">{numberFmt.format(row.calls)}</td>
              <td className="px-3 py-2 text-right text-slate-200">{formatTokens(row.inputTokens)}</td>
              <td className="px-3 py-2 text-right text-slate-200">{formatTokens(row.outputTokens)}</td>
              <td className="px-3 py-2 text-right text-slate-200">{formatCost(row.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminDashboard({
  data,
  adminEmail,
}: {
  data: AdminUsageSummary;
  adminEmail: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");

  const filteredUsers = useMemo(() => {
    const trimmed = filter.trim().toLowerCase();
    if (!trimmed) return data.users;
    return data.users.filter((user) => {
      const haystack = `${user.email ?? ""} ${user.userId}`.toLowerCase();
      return haystack.includes(trimmed);
    });
  }, [data.users, filter]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Admin</p>
            <h1 className="text-3xl font-semibold text-white">Usage command center</h1>
            <p className="text-sm text-slate-400">
              Showing the last {data.rangeDays} days. Admin: {adminEmail ?? "unknown"}.
            </p>
          </div>
          <Button variant="outline" onClick={() => router.refresh()}>
            Refresh data
          </Button>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TotalsCard label="Total spend" value={formatCost(data.totals.costUsd)} />
          <TotalsCard label="Total calls" value={numberFmt.format(data.totals.calls)} />
          <TotalsCard
            label="Total tokens"
            value={formatTokens(data.totals.inputTokens + data.totals.cachedTokens + data.totals.outputTokens)}
            sub={`Input ${formatTokens(data.totals.inputTokens)} · Cached ${formatTokens(data.totals.cachedTokens)} · Output ${formatTokens(data.totals.outputTokens)}`}
          />
          <TotalsCard label="Active users" value={numberFmt.format(data.users.length)} />
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Users</h2>
              <p className="text-sm text-slate-400">Spend, tokens, and detailed breakdowns per user.</p>
            </div>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search by email or user id"
              className="w-full max-w-xs rounded-full border border-white/10 bg-black/40 px-4 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
          </div>

          <div className="space-y-4">
            {filteredUsers.length === 0 ? (
              <p className="text-sm text-slate-400">No users match the current filter.</p>
            ) : (
              filteredUsers.map((user) => (
                <details
                  key={user.userId}
                  className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3"
                >
                  <summary className="flex flex-wrap items-center justify-between gap-4 cursor-pointer">
                    <div>
                      <p className="text-sm text-slate-400">User</p>
                      <p className="text-base font-semibold text-white">
                        {user.email ?? user.userId}
                      </p>
                      <p className="text-xs text-slate-500">Last active: {formatDateTime(user.lastActiveAt)}</p>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-slate-200">
                      <div>
                        <p className="text-xs text-slate-400">Spend</p>
                        <p className="font-semibold">{formatCost(user.totals.costUsd)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Calls</p>
                        <p className="font-semibold">{numberFmt.format(user.totals.calls)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Tokens</p>
                        <p className="font-semibold">
                          {formatTokens(user.totals.inputTokens + user.totals.cachedTokens + user.totals.outputTokens)}
                        </p>
                      </div>
                    </div>
                  </summary>

                  <div className="mt-6 space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold">Event breakdown</h3>
                      <p className="text-sm text-slate-400">
                        Each row shows calls + tokens for a model/event type.
                      </p>
                      <div className="mt-3">
                        <BreakdownTable rows={user.breakdown} />
                      </div>
                    </div>

                    <div>
                      <h3 className="text-lg font-semibold">Router usage</h3>
                      <p className="text-sm text-slate-400">
                        Decision + writer router stages from the web/search pipeline.
                      </p>
                      <div className="mt-3">
                        <StageTable rows={user.routerStages} />
                      </div>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
