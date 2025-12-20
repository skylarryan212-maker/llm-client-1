import { NextResponse } from "next/server";

import {
  createMarketAgentEvent,
  getMarketAgentEvents,
  getMarketAgentInstance,
  getMarketAgentThesis,
  upsertMarketAgentThesis,
} from "@/lib/data/market-agent";
import { getUserPlan } from "@/app/actions/plan-actions";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function POST(request: Request, context: { params: Promise<{ instanceId: string }> }) {
  const plan = await getUserPlan();
  const isDev = process.env.NODE_ENV !== "production";
  if (!isDev && plan !== "max") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { instanceId } = await context.params;
  const userId = await requireUserIdServer();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const instance = await getMarketAgentInstance(instanceId, userId);
  if (!instance) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existingThesis = await getMarketAgentThesis(instanceId);
  if (!existingThesis) {
    await upsertMarketAgentThesis({
      instanceId,
      bias: "Bullish quality tech; cautious on broader indices.",
      watched: instance.watchlist?.length ? instance.watchlist : ["SPY", "QQQ", "NVDA"],
      key_levels: {
        NVDA: { support: 820, resistance: 860 },
        QQQ: { support: 470, resistance: 490 },
      },
      invalidation: "Close below key support on heavy volume.",
      next_check: "Reassess at NY close or on next macro print.",
    });
  }

  const sampleEvents = [
    {
      kind: "report",
      title: "Opening prep: semis leading",
      summary: "Semi strength vs broad tape; watching NVDA/TSM as leaders.",
      bodyMd: "- NVDA holding >20d EMA; buyers on dips.\n- TSM ADR reclaiming 140; upside room to 150.\n- SPY stuck in range; breadth narrow.",
      severityLabel: "med",
      tickers: ["NVDA", "TSM", "SPY"],
    },
    {
      kind: "alert",
      title: "NVDA at resistance",
      summary: "NVDA approaching 860 resistance; monitor for reversal wicks.",
      bodyMd: "Intraday push toward 860. Watch for:\n- Rejection w/ >1.5x volume\n- Hold above 845 keeps short-term bullish bias intact.",
      severityLabel: "high",
      tickers: ["NVDA"],
    },
    {
      kind: "state_change",
      title: "Bias trimmed",
      summary: "Trimmed risk; awaiting confirmation on breadth.",
      bodyMd: "Reduced exposure after weak breadth in afternoon. Will re-add if QQQ > 485 with improving A/D.",
      severityLabel: "low",
      tickers: ["QQQ", "SPY"],
    },
    {
      kind: "note",
      title: "Macro watch",
      summary: "CPI tomorrow; expect higher vol at open.",
      bodyMd: "- Keep sizing tight pre-print\n- Focus on liquid tickers for quick adjustments",
      severityLabel: "med",
      tickers: ["SPY", "QQQ"],
    },
  ];

  for (const evt of sampleEvents) {
    await createMarketAgentEvent({
      instanceId,
      kind: evt.kind,
      title: evt.title,
      summary: evt.summary,
      bodyMd: evt.bodyMd,
      severityLabel: evt.severityLabel,
      tickers: evt.tickers,
    });
  }

  const thesis = await getMarketAgentThesis(instanceId);
  const events = await getMarketAgentEvents({ instanceId, limit: 20 });

  return NextResponse.json({ thesis, events });
}
