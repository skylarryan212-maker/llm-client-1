import { NextResponse } from "next/server";

import {
  createMarketAgentEvent,
  getMarketAgentEvents,
  getMarketAgentInstance,
  getMarketAgentThesis,
  upsertMarketAgentThesis,
} from "@/lib/data/market-agent";
import { requireUserIdServer } from "@/lib/supabase/user";

export async function POST(request: Request, context: { params: Promise<{ instanceId: string }> }) {

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
      title: "Report 1",
      summary: "Semis led early; breadth still narrow. Focus on liquid leaders.",
      bodyMd:
        "## Report 1 — Opening tone\n- NVDA and QQQ led risk-on flows; buyers defended dips.\n- Breadth remains narrow; keep sizing tight.\n- Watch 860 on NVDA and 490 on QQQ for confirmation.\n\n**Plan:** stay tactical, add only on confirmed breakouts.",
      tickers: ["NVDA", "QQQ", "SPY"],
    },
    {
      kind: "report",
      title: "Report 2",
      summary: "Midday update: volatility compressed; waiting on catalyst.",
      bodyMd:
        "## Report 2 — Midday update\n- Volatility compressed into lunch; tape is coiling.\n- Semis steady, mega-cap bid shallow.\n- Avoid chasing; keep powder for catalyst.\n\n**Watch:** QQQ 485, SPY 513 for range breaks.",
      tickers: ["QQQ", "SPY", "NVDA"],
    },
    {
      kind: "report",
      title: "Report 3",
      summary: "Afternoon check: momentum faded, risk trimmed.",
      bodyMd:
        "## Report 3 — Afternoon check\n- Momentum cooled; breadth failed to expand.\n- Trimmed risk and tightened stops.\n- Waiting for confirmation before re-adding.\n\n**Risk:** headline volatility into close.",
      tickers: ["SPY", "QQQ"],
    },
    {
      kind: "report",
      title: "Report 4",
      summary: "Close recap: focus remains on leading semis and index levels.",
      bodyMd:
        "## Report 4 — Close recap\n- Buyers defended key supports into the close.\n- Semis remain leadership pocket; watch NVDA/QQQ.\n- Plan next session around key levels.\n\n**Next:** reassess at NY open.",
      tickers: ["NVDA", "QQQ", "SPY"],
    },
  ];

  for (const evt of sampleEvents) {
    await createMarketAgentEvent({
      instanceId,
      kind: evt.kind,
      title: evt.title,
      summary: evt.summary,
      bodyMd: evt.bodyMd,
      tickers: evt.tickers,
    });
  }

  const thesis = await getMarketAgentThesis(instanceId);
  const events = await getMarketAgentEvents({ instanceId, limit: 20 });

  return NextResponse.json({ thesis, events });
}
