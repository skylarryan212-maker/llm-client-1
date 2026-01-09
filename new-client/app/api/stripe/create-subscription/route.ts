import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export const runtime = "nodejs";

const PLAN_PRICE_MAP: Record<string, string | undefined> = {
  plus: process.env.STRIPE_PRICE_PLUS,
  max: process.env.STRIPE_PRICE_MAX,
};

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      console.error("[stripe] Missing STRIPE_SECRET_KEY");
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as { plan?: string } | null;
    const plan = typeof body?.plan === "string" ? body.plan.toLowerCase() : "";
    const priceId = PLAN_PRICE_MAP[plan];
    if (!priceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const customerParams = new URLSearchParams();
    customerParams.append("metadata[user_id]", userId);
    customerParams.append("metadata[plan]", plan);

    const customerRes = await fetch("https://api.stripe.com/v1/customers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: customerParams.toString(),
    });

    const customerData = (await customerRes.json()) as { id?: string };
    if (!customerRes.ok || !customerData?.id) {
      console.error("[stripe] Failed to create customer", {
        status: customerRes.status,
        body: customerData,
      });
      return NextResponse.json({ error: "stripe_customer_error" }, { status: 500 });
    }

    const subscriptionParams = new URLSearchParams();
    subscriptionParams.append("customer", customerData.id);
    subscriptionParams.append("items[0][price]", priceId);
    subscriptionParams.append("payment_behavior", "default_incomplete");
    subscriptionParams.append("payment_settings[save_default_payment_method]", "on_subscription");
    subscriptionParams.append("expand[0]", "latest_invoice.payment_intent");
    subscriptionParams.append("metadata[user_id]", userId);
    subscriptionParams.append("metadata[plan]", plan);

    const subscriptionRes = await fetch("https://api.stripe.com/v1/subscriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: subscriptionParams.toString(),
    });

    const subscriptionData = (await subscriptionRes.json()) as {
      id?: string;
      latest_invoice?: { payment_intent?: { client_secret?: string } };
    };
    const clientSecret = subscriptionData.latest_invoice?.payment_intent?.client_secret;
    if (!subscriptionRes.ok || !clientSecret) {
      console.error("[stripe] Failed to create subscription", {
        status: subscriptionRes.status,
        body: subscriptionData,
      });
      return NextResponse.json({ error: "stripe_subscription_error" }, { status: 500 });
    }

    return NextResponse.json({ clientSecret, subscriptionId: subscriptionData.id });
  } catch (error) {
    console.error("[stripe] Unexpected error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
