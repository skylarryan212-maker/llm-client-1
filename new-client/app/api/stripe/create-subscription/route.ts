import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getCurrentUserIdServer } from "@/lib/supabase/user";

export const runtime = "nodejs";

const PLAN_PRICE_MAP: Record<string, string | undefined> = {
  plus: process.env.STRIPE_PRICE_PLUS,
  max: process.env.STRIPE_PRICE_MAX,
};

const PLAN_ORDER: Record<string, number> = {
  free: 0,
  plus: 1,
  max: 2,
};

function resolvePlanFromPrice(priceId?: string | null): "plus" | "max" | null {
  if (!priceId) return null;
  if (priceId === PLAN_PRICE_MAP.plus) return "plus";
  if (priceId === PLAN_PRICE_MAP.max) return "max";
  return null;
}

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

    const supabase = await supabaseServer();
    const { data: existingPlanRow } = await supabase
      .from("user_plans")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    let stripeCustomerId: string | null =
      existingPlanRow?.stripe_customer_id ? String(existingPlanRow.stripe_customer_id) : null;

    if (!stripeCustomerId) {
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

      stripeCustomerId = customerData.id;
      console.info("[stripe] Created customer", { userId, stripeCustomerId });
    }

    if (!stripeCustomerId) {
      return NextResponse.json({ error: "stripe_customer_error" }, { status: 500 });
    }

    try {
      await supabase
        .from("user_plans")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("user_id", userId);
    } catch (error) {
      console.error("[stripe] Failed to store customer id", error);
    }

    let existingDefaultPaymentMethod: string | null = null;
    if (stripeCustomerId) {
      const customerRes = await fetch(
        `https://api.stripe.com/v1/customers/${stripeCustomerId}?expand[]=invoice_settings.default_payment_method`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      if (customerRes.ok) {
        const customerData = (await customerRes.json()) as {
          invoice_settings?: { default_payment_method?: string | { id?: string } | null };
        };
        const pm = customerData?.invoice_settings?.default_payment_method;
        if (typeof pm === "string") {
          existingDefaultPaymentMethod = pm;
        } else if (pm && typeof pm === "object" && typeof pm.id === "string") {
          existingDefaultPaymentMethod = pm.id;
        }
        console.info("[stripe] Customer default PM lookup", {
          userId,
          stripeCustomerId,
          defaultPaymentMethod: existingDefaultPaymentMethod ?? null,
        });
      } else {
        console.warn("[stripe] Failed to fetch customer for PM", {
          userId,
          stripeCustomerId,
          status: customerRes.status,
        });
      }

      if (!existingDefaultPaymentMethod) {
        const pmListRes = await fetch(
          `https://api.stripe.com/v1/payment_methods?customer=${stripeCustomerId}&type=card&limit=3`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );
        if (pmListRes.ok) {
          const pmList = (await pmListRes.json()) as { data?: Array<{ id: string }> };
          if (pmList?.data && pmList.data.length > 0) {
            existingDefaultPaymentMethod = pmList.data[0].id;
            console.info("[stripe] Using first saved payment method", {
              userId,
              stripeCustomerId,
              defaultPaymentMethod: existingDefaultPaymentMethod,
            });
          }
        } else {
          console.warn("[stripe] Failed to list payment methods", {
            userId,
            stripeCustomerId,
            status: pmListRes.status,
          });
        }
      }
    }

    const listSubsRes = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${stripeCustomerId}&status=active&limit=1&expand[]=data.items&expand[]=data.latest_invoice.payment_intent`,
      {
        headers: { Authorization: `Bearer ${secretKey}` },
      }
    );
    const listSubs = (await listSubsRes.json()) as {
      data?: Array<{
        id: string;
        status?: string;
        items?: { data?: Array<{ id: string; price?: { id?: string } | null }> };
        latest_invoice?: { id?: string; payment_intent?: any };
      }>;
    };

    const activeSub = listSubsRes.ok && listSubs.data && listSubs.data.length > 0 ? listSubs.data[0] : null;
    const existingItemId = activeSub?.items?.data?.[0]?.id;
    const existingPriceId = activeSub?.items?.data?.[0]?.price?.id;
    const existingPlan = resolvePlanFromPrice(existingPriceId);
    const targetPlan = resolvePlanFromPrice(priceId);
    const isDowngradeOnExisting =
      existingPlan && targetPlan && PLAN_ORDER[existingPlan] > PLAN_ORDER[targetPlan];
    if (!existingDefaultPaymentMethod) {
      existingDefaultPaymentMethod =
        typeof (activeSub as any)?.default_payment_method === "string"
          ? (activeSub as any).default_payment_method
          : typeof (activeSub as any)?.latest_invoice?.payment_intent?.payment_method === "string"
          ? (activeSub as any).latest_invoice.payment_intent.payment_method
          : null;
      if (existingDefaultPaymentMethod) {
        console.info("[stripe] Found default PM from active subscription", {
          userId,
          stripeCustomerId,
          defaultPaymentMethod: existingDefaultPaymentMethod,
        });
      }
    }

    // Ensure the customer default payment method is set so Stripe can surface it automatically.
    if (existingDefaultPaymentMethod) {
      const setDefaultRes = await fetch(`https://api.stripe.com/v1/customers/${stripeCustomerId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          "invoice_settings[default_payment_method]": existingDefaultPaymentMethod,
        }).toString(),
      });
      if (!setDefaultRes.ok) {
        const body = (await setDefaultRes.json().catch(() => null)) as any;
        console.warn("[stripe] Failed to set customer default payment method", {
          status: setDefaultRes.status,
          body,
          stripeCustomerId,
          paymentMethod: existingDefaultPaymentMethod,
        });
      } else {
        console.info("[stripe] Set customer default payment method", {
          stripeCustomerId,
          paymentMethod: existingDefaultPaymentMethod,
        });
      }
    }

    let customerSessionClientSecret: string | null = null;
    let ephemeralKeySecret: string | null = null;
    if (stripeCustomerId) {
      const sessionRes = await fetch("https://api.stripe.com/v1/customer_sessions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          customer: stripeCustomerId,
          "components[payment_element][enabled]": "true",
        }).toString(),
      });
      if (sessionRes.ok) {
        const sessionData = (await sessionRes.json()) as { client_secret?: string };
        customerSessionClientSecret = sessionData.client_secret ?? null;
        console.info("[stripe] Created customer session", {
          stripeCustomerId,
          hasClientSecret: Boolean(customerSessionClientSecret),
        });
      } else {
        const body = (await sessionRes.json().catch(() => null)) as any;
        console.warn("[stripe] Failed to create customer session", {
          stripeCustomerId,
          status: sessionRes.status,
          body,
        });
      }

      const stripeVersion = process.env.STRIPE_API_VERSION || "2023-10-16";
      const ephemeralRes = await fetch("https://api.stripe.com/v1/ephemeral_keys", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Stripe-Version": stripeVersion,
        },
        body: new URLSearchParams({
          customer: stripeCustomerId,
        }).toString(),
      });
      if (ephemeralRes.ok) {
        const ephemeralData = (await ephemeralRes.json()) as { secret?: string };
        ephemeralKeySecret = ephemeralData.secret ?? null;
        console.info("[stripe] Created ephemeral key", {
          stripeCustomerId,
          hasSecret: Boolean(ephemeralKeySecret),
          stripeVersion,
        });
      } else {
        const body = (await ephemeralRes.json().catch(() => null)) as any;
        console.warn("[stripe] Failed to create ephemeral key", {
          stripeCustomerId,
          status: ephemeralRes.status,
          body,
          stripeVersion,
        });
      }
    }
    const isUpgradeOnExisting = activeSub && existingItemId && existingPriceId && existingPriceId !== priceId;

    type SubscriptionData =
      | {
          id?: string;
          latest_invoice?: { id?: string; payment_intent?: { id?: string; client_secret?: string } | string | null };
        }
      | null;

    let subscriptionData: SubscriptionData = null;

    if ((isUpgradeOnExisting || isDowngradeOnExisting) && existingItemId) {
      // Update existing subscription to new price.
      const updateParams = new URLSearchParams();
      updateParams.append("items[0][id]", existingItemId);
      updateParams.append("items[0][price]", priceId);
      updateParams.append("cancel_at_period_end", "false");
      updateParams.append("payment_settings[save_default_payment_method]", "on_subscription");
      updateParams.append("payment_settings[payment_method_types][0]", "card");
      updateParams.append("expand[]", "latest_invoice.payment_intent");
      updateParams.append("metadata[user_id]", userId);
      updateParams.append("metadata[plan]", plan);

      if (isDowngradeOnExisting) {
        // No proration, no immediate charge; take effect next billing cycle without charging now.
        updateParams.append("proration_behavior", "none");
        updateParams.append("payment_behavior", "allow_incomplete");
        // Keep current default PM but do not force payment now.
        if (existingDefaultPaymentMethod) {
          updateParams.append("default_payment_method", existingDefaultPaymentMethod);
        }
      } else {
        // Upgrade: apply proration and capture payment intent.
        updateParams.append("payment_behavior", "default_incomplete");
        updateParams.append("proration_behavior", "create_prorations");
        if (existingDefaultPaymentMethod) {
          updateParams.append("default_payment_method", existingDefaultPaymentMethod);
        }
      }

      const updateRes = await fetch(`https://api.stripe.com/v1/subscriptions/${activeSub.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: updateParams.toString(),
      });
      subscriptionData = (await updateRes.json()) as SubscriptionData;
      if (!updateRes.ok) {
        console.error("[stripe] Failed to update subscription", {
          status: updateRes.status,
          body: subscriptionData,
        });
        // fall back to new subscription creation below
        subscriptionData = null;
      }
      console.info("[stripe] Updated existing subscription for change", {
        userId,
        subscriptionId: subscriptionData?.id,
        reusedPm: Boolean(existingDefaultPaymentMethod),
        downgrade: isDowngradeOnExisting,
      });
    }

    if (!subscriptionData) {
      const subscriptionParams = new URLSearchParams();
      subscriptionParams.append("customer", stripeCustomerId);
      subscriptionParams.append("items[0][price]", priceId);
      subscriptionParams.append("payment_behavior", "default_incomplete");
      subscriptionParams.append("payment_settings[save_default_payment_method]", "on_subscription");
      subscriptionParams.append("payment_settings[payment_method_types][0]", "card");
      if (existingDefaultPaymentMethod) {
        subscriptionParams.append("default_payment_method", existingDefaultPaymentMethod);
      }
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

      subscriptionData = (await subscriptionRes.json()) as SubscriptionData;

      if (!subscriptionRes.ok) {
        console.error("[stripe] Failed to create subscription", {
          status: subscriptionRes.status,
          body: subscriptionData,
        });
        return NextResponse.json({ error: "stripe_subscription_error" }, { status: 500 });
      }
      console.info("[stripe] Created new subscription", {
        userId,
        subscriptionId: subscriptionData?.id,
        reusedPm: Boolean(existingDefaultPaymentMethod),
      });
    }

    if (!subscriptionData) {
      console.error("[stripe] Missing subscription data after creation/update");
      return NextResponse.json({ error: "stripe_subscription_error" }, { status: 500 });
    }

    const invoiceRef = subscriptionData.latest_invoice;
    const invoiceId = typeof invoiceRef === "string" ? invoiceRef : invoiceRef?.id;
    const paymentIntentIdRaw = typeof invoiceRef === "string" ? undefined : invoiceRef?.payment_intent;
    const paymentIntentId =
      typeof paymentIntentIdRaw === "string"
        ? paymentIntentIdRaw
        : typeof paymentIntentIdRaw === "object"
        ? paymentIntentIdRaw?.id
        : undefined;

    let clientSecret =
      typeof paymentIntentIdRaw === "object"
        ? paymentIntentIdRaw?.client_secret
        : undefined;

    type InvoiceSnapshot = {
      id?: string;
      status?: string;
      paid?: boolean;
      amount_due?: number;
      total?: number;
      currency?: string;
      customer?: string;
      payment_intent?: { id?: string; client_secret?: string } | string | null;
    };

    const resolveClientSecretFromInvoice = async (sourceInvoiceId: string) => {
      const invoiceRes = await fetch(
        `https://api.stripe.com/v1/invoices/${sourceInvoiceId}?expand[]=payment_intent`,
        {
          headers: { Authorization: `Bearer ${secretKey}` },
        }
      );
      const invoiceData = (await invoiceRes.json()) as InvoiceSnapshot;
      if (!invoiceRes.ok) return { clientSecret: null, invoice: null };
      if (typeof invoiceData.payment_intent === "string") {
        const intentRes = await fetch(
          `https://api.stripe.com/v1/payment_intents/${invoiceData.payment_intent}`,
          { headers: { Authorization: `Bearer ${secretKey}` } }
        );
        const intentData = (await intentRes.json()) as { client_secret?: string };
        return {
          clientSecret: intentRes.ok ? intentData.client_secret ?? null : null,
          invoice: invoiceData,
        };
      }
      return {
        clientSecret: invoiceData.payment_intent?.client_secret ?? null,
        invoice: invoiceData,
      };
    };

    const createPaymentIntentForInvoice = async (
      invoice: InvoiceSnapshot | null
    ) => {
      if (!invoice) return null;
      const amount = invoice.total ?? invoice.amount_due;
      const currency = invoice.currency;
      if (!amount || !currency) return null;

      const piParams = new URLSearchParams();
      piParams.append("amount", amount.toString());
      piParams.append("currency", currency);
      piParams.append("customer", invoice.customer || stripeCustomerId || "");
      piParams.append("payment_method_types[0]", "card");
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
      if (!piRes.ok) {
        console.warn("[stripe] Failed to create payment intent from invoice", {
          status: piRes.status,
          body: piData,
        });
        return null;
      }
      return piData.client_secret ?? null;
    };

    const hasSubscription = Boolean(subscriptionData?.id);
    let invoiceSnapshot: InvoiceSnapshot | null = null;
    if (hasSubscription && !clientSecret && invoiceId) {
      // Ensure the invoice is finalized so a payment intent is generated.
      // Only finalize if still in draft.
      const existingInvoice = await resolveClientSecretFromInvoice(invoiceId);
      invoiceSnapshot = existingInvoice.invoice ?? invoiceSnapshot;
      const needsFinalize = invoiceSnapshot?.status === "draft";

      if (needsFinalize) {
        const finalizeRes = await fetch(
          `https://api.stripe.com/v1/invoices/${invoiceId}/finalize?expand[]=payment_intent`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${secretKey}` },
          }
        );
        const finalized = (await finalizeRes.json()) as InvoiceSnapshot;
        if (finalizeRes.ok) {
          invoiceSnapshot = finalized;
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
      }

      if (!clientSecret) {
        const resolved = await resolveClientSecretFromInvoice(invoiceId);
        clientSecret = resolved.clientSecret ?? undefined;
        invoiceSnapshot = resolved.invoice ?? invoiceSnapshot;
      }

      // If still no payment intent, try paying the invoice (only if we have a saved PM) — only for upgrades.
      if (!clientSecret && invoiceSnapshot?.id && existingDefaultPaymentMethod && !isDowngradeOnExisting) {
        const payParams = new URLSearchParams();
        payParams.append("payment_method", existingDefaultPaymentMethod);
        const payRes = await fetch(
          `https://api.stripe.com/v1/invoices/${invoiceSnapshot.id}/pay?expand[]=payment_intent`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${secretKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: payParams.toString(),
          }
        );
        const payData = (await payRes.json()) as InvoiceSnapshot;
        if (payRes.ok) {
          invoiceSnapshot = payData;
          if (typeof payData.payment_intent === "string") {
            const intentRes = await fetch(
              `https://api.stripe.com/v1/payment_intents/${payData.payment_intent}`,
              { headers: { Authorization: `Bearer ${secretKey}` } }
            );
            const intentData = (await intentRes.json()) as { client_secret?: string };
            if (intentRes.ok) {
              clientSecret = intentData.client_secret;
            }
          } else {
            clientSecret = payData.payment_intent?.client_secret ?? clientSecret;
          }
        } else {
          console.warn("[stripe] Failed to pay invoice during checkout", {
            invoiceId: invoiceSnapshot.id,
            status: payRes.status,
            body: payData,
          });
        }
      }

      // Fallback: create a PaymentIntent from the invoice amounts so the client can confirm with card entry.
      if (!clientSecret && invoiceSnapshot) {
        clientSecret = (await createPaymentIntentForInvoice(invoiceSnapshot)) ?? undefined;
      }
    }
    if (!clientSecret) {
      if (!invoiceSnapshot && invoiceId) {
        const resolved = await resolveClientSecretFromInvoice(invoiceId);
        invoiceSnapshot = resolved.invoice;
      }
      const invoiceTotal = invoiceSnapshot?.total ?? invoiceSnapshot?.amount_due;
      if (
        invoiceSnapshot &&
        (invoiceTotal === 0 || invoiceTotal === null || invoiceTotal === undefined || invoiceSnapshot.paid)
      ) {
        return NextResponse.json({
          subscriptionId: subscriptionData.id,
          noPaymentRequired: true,
        });
      }
      console.error("[stripe] Missing invoice payment intent", {
        invoiceId,
        subscriptionId: subscriptionData.id,
        invoiceStatus: invoiceSnapshot?.status,
        invoicePaid: invoiceSnapshot?.paid,
        invoiceTotal,
      });
      console.error("[stripe] Failed to resolve client secret", { invoiceId, subscriptionId: subscriptionData.id });
      return NextResponse.json({ error: "stripe_subscription_error" }, { status: 500 });
    }

    return NextResponse.json({
      clientSecret,
      subscriptionId: subscriptionData.id,
      reusedCustomer: Boolean(stripeCustomerId),
      updatedExistingSubscription: Boolean(isUpgradeOnExisting),
      customerSessionClientSecret,
      stripeCustomerId,
      ephemeralKeySecret,
      paymentIntentId,
    });
  } catch (error) {
    console.error("[stripe] Unexpected error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
