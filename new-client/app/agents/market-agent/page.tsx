export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { notFound } from "next/navigation";

import { MarketAgentLanding } from "@/components/market-agent/market-agent-landing";
import { getMarketAgentFeed } from "@/lib/data/market-agent";

export default async function MarketAgentPage() {
  let data: Awaited<ReturnType<typeof getMarketAgentFeed>> | null = null;
  try {
    data = await getMarketAgentFeed({ limit: 14 });
  } catch (error) {
    console.error("Failed to load market agent page", error);
    notFound();
  }

  if (!data) {
    notFound();
  }

  return <MarketAgentLanding initialEvents={data.events} initialInstances={data.instances} />;
}
