import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export const runtime = "nodejs";

const PLAN_PRICE_MAP: Record<string, string | undefined> = {
  plus: process.env.STRIPE_PRICE_PLUS,
  max: process.env.STRIPE_PRICE_MAX,
};

function formatPaymentLabel(brand?: string | null, last4?: string | null) {
  const safeBrand = (brand ?? "").toUpperCase();
  const safeLast4 = last4 ?? "";
  if (!safeBrand && !safeLast4) return null;
  return `${safeBrand || "CARD"} *${safeLast4}`;
}

export async function POST(request: NextRequest) {
  try {
    const userId = await getCurrentUserIdServer();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as { plan?: string } | null;
    const plan = typeof body?.plan === "string" ? body.plan.toLowerCase() : "";
    const priceId = PLAN_PRICE_MAP[plan];
    if (!priceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const { data: existingPlan } = await supabase
      .from("user_plans")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    const stripeCustomerId = existingPlan?.stripe_customer_id ?? null;
    if (!stripeCustomerId) {
      return NextResponse.json({ oneClickAvailable: false, reason: "missing_customer" });
    }

    const subsRes = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${stripeCustomerId}&status=all&limit=5&expand[]=data.items&expand[]=data.latest_invoice.payment_intent`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const subsData = (await subsRes.json()) as {
      data?: Array<{
        id: string;
        status?: string;
        items?: { data?: Array<{ id: string; price?: { id?: string } | null }> };
        latest_invoice?: { status?: string; paid?: boolean; payment_intent?: { status?: string } | null };
      }>;
    };
    if (!subsRes.ok) {
      return NextResponse.json({ oneClickAvailable: false, reason: "subscription_lookup_failed" });
    }

    const isPaidLike = (sub: {
      latest_invoice?: { status?: string; paid?: boolean; payment_intent?: { status?: string } | null };
    }) => {
      const invoice = sub.latest_invoice;
      const paymentStatus = invoice?.payment_intent?.status;
      return (
        Boolean(invoice?.paid) ||
        invoice?.status === "paid" ||
        paymentStatus === "succeeded" ||
        paymentStatus === "processing"
      );
    };

    const activeSub =
      subsData.data?.find(
        (sub) =>
          sub.status === "active" ||
          sub.status === "trialing" ||
          sub.status === "past_due" ||
          (sub.status === "incomplete" && isPaidLike(sub))
      ) || null;

    if (!activeSub?.items?.data?.[0]?.price?.id) {
      return NextResponse.json({ oneClickAvailable: false, reason: "no_active_subscription" });
    }

    if (activeSub.items.data[0].price?.id === priceId) {
      return NextResponse.json({ oneClickAvailable: false, reason: "already_on_plan" });
    }

    const customerRes = await fetch(
      `https://api.stripe.com/v1/customers/${stripeCustomerId}?expand[]=invoice_settings.default_payment_method`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    let paymentMethodId: string | null = null;
    if (customerRes.ok) {
      const customerData = (await customerRes.json()) as {
        invoice_settings?: { default_payment_method?: string | { id?: string } | null };
      };
      const pm = customerData?.invoice_settings?.default_payment_method;
      if (typeof pm === "string") paymentMethodId = pm;
      if (!paymentMethodId && pm && typeof pm === "object" && typeof pm.id === "string") {
        paymentMethodId = pm.id;
      }
    }

    if (!paymentMethodId) {
      const pmListRes = await fetch(
        `https://api.stripe.com/v1/payment_methods?customer=${stripeCustomerId}&type=card&limit=1`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      if (pmListRes.ok) {
        const pmList = (await pmListRes.json()) as { data?: Array<{ id: string }> };
        paymentMethodId = pmList?.data?.[0]?.id ?? null;
      }
    }

    if (!paymentMethodId) {
      return NextResponse.json({ oneClickAvailable: false, reason: "no_payment_method" });
    }

    const pmRes = await fetch(`https://api.stripe.com/v1/payment_methods/${paymentMethodId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    let paymentMethodLabel: string | null = null;
    if (pmRes.ok) {
      const pmData = (await pmRes.json()) as { card?: { brand?: string; last4?: string } };
      paymentMethodLabel = formatPaymentLabel(pmData.card?.brand, pmData.card?.last4);
    }

    return NextResponse.json({
      oneClickAvailable: true,
      paymentMethodLabel,
    });
  } catch (error) {
    console.error("[stripe] Upgrade preview error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
