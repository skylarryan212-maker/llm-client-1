import { NextRequest, NextResponse } from "next/server";
import { supabaseServerAdmin } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export const runtime = "nodejs";

const PLAN_PRICE_MAP: Record<string, string | undefined> = {
  plus: process.env.STRIPE_PRICE_PLUS,
  max: process.env.STRIPE_PRICE_MAX,
};

function toIso(value?: number | null) {
  if (!value) return null;
  return new Date(value * 1000).toISOString();
}

function resolvePlanFromSubscription(subscription: any): "plus" | "max" | null {
  const metadataPlan = subscription?.metadata?.plan;
  if (metadataPlan === "plus" || metadataPlan === "max") {
    return metadataPlan;
  }
  const priceId = subscription?.items?.data?.[0]?.price?.id;
  if (!priceId) return null;
  if (priceId === PLAN_PRICE_MAP.plus) return "plus";
  if (priceId === PLAN_PRICE_MAP.max) return "max";
  return null;
}

async function applyPlanUpdate(userId: string, planType: "free" | "plus" | "max", subscription: any) {
  const supabase = await supabaseServerAdmin();
  const isFree = planType === "free";
  const currentPeriodStart = isFree ? null : toIso(subscription?.current_period_start);
  const currentPeriodEnd = isFree ? null : toIso(subscription?.current_period_end);
  const cancelAt = toIso(subscription?.cancel_at);
  const cancelAtPeriodEnd = Boolean(subscription?.cancel_at_period_end);
  const canceledAt = toIso(subscription?.canceled_at);

  const { error } = await supabase.from("user_plans").upsert(
    {
      user_id: userId,
      plan_type: planType,
      is_active: !isFree,
      cancel_at: cancelAt,
      cancel_at_period_end: cancelAtPeriodEnd,
      canceled_at: canceledAt,
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("[stripe-sync] Failed to update user_plans", error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      console.error("[stripe-sync] Missing STRIPE_SECRET_KEY");
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as { subscriptionId?: string } | null;
    const subscriptionId = typeof body?.subscriptionId === "string" ? body.subscriptionId : "";
    if (!subscriptionId) {
      return NextResponse.json({ error: "Missing subscriptionId" }, { status: 400 });
    }

    const subscriptionRes = await fetch(
      `https://api.stripe.com/v1/subscriptions/${subscriptionId}?expand[]=items.data.price&expand[]=latest_invoice.payment_intent`,
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      }
    );
    const subscription = (await subscriptionRes.json()) as any;
    if (!subscriptionRes.ok) {
      console.error("[stripe-sync] Failed to fetch subscription", {
        status: subscriptionRes.status,
        body: subscription,
      });
      return NextResponse.json({ error: "stripe_subscription_error" }, { status: 500 });
    }

    const metadataUserId = subscription?.metadata?.user_id;
    if (!metadataUserId || metadataUserId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const plan = resolvePlanFromSubscription(subscription);
    const status = subscription?.status as string | undefined;
    let invoiceStatus = subscription?.latest_invoice?.status as string | undefined;
    let invoicePaid = Boolean(subscription?.latest_invoice?.paid);
    let latestPaymentIntent = subscription?.latest_invoice?.payment_intent;
    let paymentIntentStatus: string | undefined;

    if (typeof subscription?.latest_invoice === "string") {
      const invoiceRes = await fetch(
        `https://api.stripe.com/v1/invoices/${subscription.latest_invoice}?expand[]=payment_intent`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const invoiceData = (await invoiceRes.json()) as {
        status?: string;
        paid?: boolean;
        payment_intent?: string | { status?: string } | null;
      };
      if (invoiceRes.ok) {
        invoiceStatus = invoiceData.status;
        invoicePaid = Boolean(invoiceData.paid);
        latestPaymentIntent = invoiceData.payment_intent;
      }
    }

    if (latestPaymentIntent && typeof latestPaymentIntent === "object") {
      paymentIntentStatus = latestPaymentIntent.status as string | undefined;
    } else if (typeof latestPaymentIntent === "string") {
      const intentRes = await fetch(
        `https://api.stripe.com/v1/payment_intents/${latestPaymentIntent}`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const intentData = (await intentRes.json()) as { status?: string };
      if (intentRes.ok) {
        paymentIntentStatus = intentData.status;
      }
    }
    const isPaidLike =
      invoicePaid ||
      invoiceStatus === "paid" ||
      paymentIntentStatus === "succeeded" ||
      paymentIntentStatus === "processing";

    const isActive =
      status === "active" ||
      status === "trialing" ||
      (status === "incomplete" && isPaidLike) ||
      (status === "past_due" && isPaidLike);

    if (!plan) {
      return NextResponse.json({ error: "plan_unresolved" }, { status: 409 });
    }

    if (!isActive) {
      return NextResponse.json({ error: "subscription_not_active" }, { status: 409 });
    }

    await applyPlanUpdate(userId, plan, subscription);
    return NextResponse.json({ plan });
  } catch (error) {
    console.error("[stripe-sync] Unexpected error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
