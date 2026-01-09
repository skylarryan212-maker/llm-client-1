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
    // Enable Stripe to choose the best available methods (wallets/card) via top-level APM.
    subscriptionParams.append("automatic_payment_methods[enabled]", "true");
    subscriptionParams.append("expand[]", "latest_invoice.payment_intent");
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
      latest_invoice?: {
        id?: string;
        payment_intent?: { id?: string; client_secret?: string } | string | null;
      };
    };
    const invoiceId = subscriptionData.latest_invoice?.id;
    let clientSecret =
      typeof subscriptionData.latest_invoice?.payment_intent === "object"
        ? subscriptionData.latest_invoice?.payment_intent?.client_secret
        : undefined;

    const resolveClientSecretFromInvoice = async (sourceInvoiceId: string) => {
      const invoiceRes = await fetch(
        `https://api.stripe.com/v1/invoices/${sourceInvoiceId}?expand[]=payment_intent`,
        {
          headers: { Authorization: `Bearer ${secretKey}` },
        }
      );
      const invoiceData = (await invoiceRes.json()) as {
        payment_intent?: { id?: string; client_secret?: string } | string | null;
      };
      if (!invoiceRes.ok) return null;
      if (typeof invoiceData.payment_intent === "string") {
        const intentRes = await fetch(
          `https://api.stripe.com/v1/payment_intents/${invoiceData.payment_intent}`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );
        const intentData = (await intentRes.json()) as { client_secret?: string };
        return intentRes.ok ? intentData.client_secret ?? null : null;
      }
      return invoiceData.payment_intent?.client_secret ?? null;
    };

    const createPaymentIntentForInvoice = async (sourceInvoiceId: string) => {
      // Fetch invoice for amount/currency
      const invoiceRes = await fetch(
        `https://api.stripe.com/v1/invoices/${sourceInvoiceId}`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const invoiceData = (await invoiceRes.json()) as {
        amount_due?: number;
        currency?: string;
        customer?: string;
        total?: number;
      };
      if (!invoiceRes.ok) return null;
      const amount = invoiceData.total ?? invoiceData.amount_due;
      const currency = invoiceData.currency;
      if (!amount || !currency) return null;

      const piParams = new URLSearchParams();
      piParams.append("amount", amount.toString());
      piParams.append("currency", currency);
      piParams.append("customer", invoiceData.customer || customerData.id || "");
      piParams.append("automatic_payment_methods[enabled]", "true");
      piParams.append("metadata[user_id]", userId);
      piParams.append("metadata[plan]", plan);
      piParams.append("setup_future_usage", "off_session");

      const piRes = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: piParams.toString(),
      });
      const piData = (await piRes.json()) as { client_secret?: string };
      if (!piRes.ok) return null;
      return piData.client_secret ?? null;
    };

    if (subscriptionRes.ok && !clientSecret && invoiceId) {
      // Ensure the invoice is finalized so a payment intent is generated.
      const finalizeRes = await fetch(
        `https://api.stripe.com/v1/invoices/${invoiceId}/finalize?expand[]=payment_intent`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${secretKey}` },
        }
      );
      const finalized = (await finalizeRes.json()) as {
        payment_intent?: { id?: string; client_secret?: string } | string | null;
      };
      if (finalizeRes.ok) {
        if (typeof finalized.payment_intent === "string") {
          const intentRes = await fetch(
            `https://api.stripe.com/v1/payment_intents/${finalized.payment_intent}`,
            { headers: { Authorization: `Bearer ${secretKey}` } }
          );
          const intentData = (await intentRes.json()) as { client_secret?: string };
          if (intentRes.ok) {
            clientSecret = intentData.client_secret;
          }
        } else {
          clientSecret = finalized.payment_intent?.client_secret;
        }
      }
      if (!clientSecret) {
        clientSecret =
          (await resolveClientSecretFromInvoice(invoiceId)) ||
          (await createPaymentIntentForInvoice(invoiceId)) ||
          undefined;
      }
    }
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
