import { NextRequest, NextResponse } from "next/server";
import { supabaseServerAdmin } from "@/lib/supabase/server";
import crypto from "node:crypto";

export const runtime = "nodejs";

type StripeEvent = {
  id: string;
  type: string;
  data: { object: any };
};

const PLAN_PRICE_MAP: Record<string, string | undefined> = {
  plus: process.env.STRIPE_PRICE_PLUS,
  max: process.env.STRIPE_PRICE_MAX,
};

function timingSafeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyStripeSignature(rawBody: string, signatureHeader: string, secret: string) {
  const parts = signatureHeader.split(",");
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const sigPart = parts.find((part) => part.startsWith("v1="));
  if (!timestampPart || !sigPart) return false;
  const timestamp = timestampPart.split("=")[1];
  const signature = sigPart.split("=")[1];
  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
  return timingSafeEqual(expected, signature);
}

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
  const customerId =
    typeof subscription?.customer === "string"
      ? subscription.customer
      : typeof subscription?.customer?.id === "string"
      ? subscription.customer.id
      : null;

  const updatePayload: Record<string, unknown> = {
    user_id: userId,
    plan_type: planType,
    is_active: !isFree,
    cancel_at: cancelAt,
    cancel_at_period_end: cancelAtPeriodEnd,
    canceled_at: canceledAt,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
    updated_at: new Date().toISOString(),
  };
  if (customerId) {
    updatePayload.stripe_customer_id = customerId;
  }

  const { error } = await supabase.from("user_plans").upsert(updatePayload, { onConflict: "user_id" });

  if (error) {
    console.error("[stripe-webhook] Failed to update user_plans", error);
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[stripe-webhook] Missing STRIPE_WEBHOOK_SECRET");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await request.text();
  if (!verifyStripeSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch (error) {
    console.error("[stripe-webhook] Invalid JSON", error);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const obj = event.data?.object;
  if (!obj) {
    return NextResponse.json({ received: true });
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const userId = obj?.metadata?.user_id;
    if (!userId) {
      console.warn("[stripe-webhook] subscription missing user_id metadata", { eventId: event.id });
      return NextResponse.json({ received: true });
    }
    const plan = resolvePlanFromSubscription(obj);
    const status = obj?.status as string | undefined;
    const isActive = status === "active" || status === "trialing";
    const nextPlan = isActive && plan ? plan : "free";
    await applyPlanUpdate(userId, nextPlan, obj);
  }

  if (event.type === "invoice.payment_failed") {
    const subscription = obj?.subscription;
    const userId = obj?.lines?.data?.[0]?.metadata?.user_id ?? obj?.metadata?.user_id;
    if (userId) {
      await applyPlanUpdate(userId, "free", subscription);
    }
  }

  return NextResponse.json({ received: true });
}
