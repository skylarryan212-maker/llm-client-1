export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { redirect } from "next/navigation";
import Link from "next/link";

import { MarketAgentInstanceView } from "@/components/market-agent/market-agent-instance";
import {
  getMarketAgentEvents,
  getMarketAgentInstance,
  getMarketAgentState,
  type MarketAgentFeedEvent,
} from "@/lib/data/market-agent";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import { supabaseServerAdmin } from "@/lib/supabase/server";

export default async function MarketAgentInstancePage({
  params,
}: {
  params: { instanceId: string };
}) {
  const { instanceId } = params;

  const userId = await getCurrentUserIdServer();
  if (!userId) {
    redirect(`/login?next=/agents/market-agent/${instanceId}`);
  }

  const instance = await getMarketAgentInstance(instanceId, userId);
  let adminVisibleInstance: Record<string, unknown> | null = null;

  if (!instance) {
    const admin = await supabaseServerAdmin().catch(() => null);
    if (admin) {
      const { data: rawInstance } = await (admin as any)
        .from("market_agent_instances")
        .select("*")
        .eq("id", instanceId)
        .maybeSingle();
      if (rawInstance && rawInstance.user_id === userId) {
        adminVisibleInstance = rawInstance as Record<string, unknown>;
      }
    }
  }

  if (!instance && adminVisibleInstance) {
    return (
      <div className="min-h-screen bg-[#050505] text-foreground flex items-center justify-center px-4">
        <div className="max-w-md space-y-3 text-center">
          <p className="text-lg font-semibold">Market Agent found but blocked by policy</p>
          <p className="text-sm text-muted-foreground">
            The agent exists and is yours, but couldn&apos;t be loaded via the normal path. This is likely an RLS or client issue.
          </p>
          <pre className="text-left text-xs bg-black/40 p-3 rounded border border-border/60 overflow-x-auto">
            {JSON.stringify(adminVisibleInstance, null, 2)}
          </pre>
          <div className="flex justify-center gap-2">
            <Link href="/agents/market-agent" className="text-primary underline">Back to agents</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="min-h-screen bg-[#050505] text-foreground flex items-center justify-center px-4">
        <div className="max-w-md space-y-3 text-center">
          <p className="text-lg font-semibold">Market Agent unavailable</p>
          <p className="text-sm text-muted-foreground">
            This agent either doesn&apos;t exist, isn&apos;t yours, or you may need to sign in again.
          </p>
          <div className="flex justify-center gap-2">
            <Link href="/login" className="text-primary underline">Sign in</Link>
            <Link href="/agents/market-agent" className="text-primary underline">Back to agents</Link>
          </div>
        </div>
      </div>
    );
  }

  const [state, events] = await Promise.all([
    getMarketAgentState(instanceId),
    getMarketAgentEvents({ instanceId, limit: 20 }),
  ]);

  const feedEvents: MarketAgentFeedEvent[] = (events ?? []).map((evt) => ({
    ...evt,
    instance,
  }));

  return <MarketAgentInstanceView instance={instance} events={feedEvents} state={state} />;
}
