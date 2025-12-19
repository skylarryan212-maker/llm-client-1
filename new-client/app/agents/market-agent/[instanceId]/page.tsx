export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

import { notFound } from "next/navigation";
import { redirect } from "next/navigation";

import { MarketAgentInstanceView } from "@/components/market-agent/market-agent-instance";
import {
  getMarketAgentEvents,
  getMarketAgentInstance,
  getMarketAgentState,
  type MarketAgentFeedEvent,
} from "@/lib/data/market-agent";
import { getCurrentUserIdServer } from "@/lib/supabase/user";
import Link from "next/link";

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

  const instance = await getMarketAgentInstance(instanceId);
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
