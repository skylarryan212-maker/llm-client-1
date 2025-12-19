export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { notFound } from "next/navigation";

import { MarketAgentInstanceView } from "@/components/market-agent/market-agent-instance";
import {
  getMarketAgentEvents,
  getMarketAgentInstance,
  getMarketAgentState,
  type MarketAgentFeedEvent,
} from "@/lib/data/market-agent";

export default async function MarketAgentInstancePage({
  params,
}: {
  params: { instanceId: string };
}) {
  const { instanceId } = params;

  const instance = await getMarketAgentInstance(instanceId);
  if (!instance) {
    notFound();
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
