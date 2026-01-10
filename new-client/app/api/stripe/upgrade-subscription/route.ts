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
      return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as { plan?: string } | null;
    const plan = typeof body?.plan === "string" ? body.plan.toLowerCase() : "";
    const priceId = PLAN_PRICE_MAP[plan];
    if (!priceId) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const { data: userPlanRow } = await supabase
      .from("user_plans")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    const stripeCustomerId: string | null =
      userPlanRow?.stripe_customer_id ? String(userPlanRow.stripe_customer_id) : null;
    if (!stripeCustomerId) {
      return NextResponse.json({ error: "missing_customer" }, { status: 400 });
    }

    const subsRes = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${stripeCustomerId}&status=all&limit=5&expand[]=data.items&expand[]=data.latest_invoice.payment_intent`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    const subsData = (await subsRes.json()) as {
      data?: Array<{
        id: string;
        status?: string;
        current_period_start?: number;
        current_period_end?: number;
        items?: { data?: Array<{ id: string; price?: { id?: string } | null }> };
        latest_invoice?: { id?: string; payment_intent?: any };
      }>;
    };
    if (!subsRes.ok) {
      return NextResponse.json({ error: "subscription_lookup_failed" }, { status: 500 });
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

    const existingItemId = activeSub?.items?.data?.[0]?.id ?? null;
    const existingPriceId = activeSub?.items?.data?.[0]?.price?.id ?? null;
    const currentPlanFromPrice = resolvePlanFromPrice(existingPriceId);
    const targetPlan = resolvePlanFromPrice(priceId);
    const isDowngrade =
      currentPlanFromPrice && targetPlan && PLAN_ORDER[currentPlanFromPrice] > PLAN_ORDER[targetPlan];
    const isSamePlan = existingPriceId === priceId;

    let paymentMethodId: string | null = null;
    const customerRes = await fetch(
      `https://api.stripe.com/v1/customers/${stripeCustomerId}?expand[]=invoice_settings.default_payment_method`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
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

    // Handle downgrades: schedule a plan change for the next billing cycle, no immediate price change.
    if (isDowngrade && activeSub && existingPriceId) {
      const detailRes = await fetch(
        `https://api.stripe.com/v1/subscriptions/${activeSub.id}?expand[]=schedule`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const detailData = (await detailRes.json()) as {
        id?: string;
        schedule?: string | { id?: string };
        current_period_start?: number;
        current_period_end?: number;
        billing_cycle_anchor?: number;
        start_date?: number;
        plan?: { interval?: string; interval_count?: number } | null;
        items?: {
          data?: Array<{
            price?: { recurring?: { interval?: string; interval_count?: number } | null } | null;
          }>;
        };
      };
      const currentPeriodStart =
        detailData.current_period_start ??
        activeSub.current_period_start ??
        detailData.billing_cycle_anchor ??
        detailData.start_date ??
        null;
      let currentPeriodEnd =
        detailData.current_period_end ?? activeSub.current_period_end ?? null;

      const recurring =
        detailData.items?.data?.[0]?.price?.recurring ?? detailData.plan ?? null;
      const interval = recurring?.interval;
      const intervalCount = recurring?.interval_count ?? 1;

      if (!currentPeriodEnd && currentPeriodStart && interval) {
        const startDate = new Date(currentPeriodStart * 1000);
        const nextDate = new Date(startDate.getTime());
        switch (interval) {
          case "day":
            nextDate.setUTCDate(nextDate.getUTCDate() + intervalCount);
            break;
          case "week":
            nextDate.setUTCDate(nextDate.getUTCDate() + intervalCount * 7);
            break;
          case "month":
            nextDate.setUTCMonth(nextDate.getUTCMonth() + intervalCount);
            break;
          case "year":
            nextDate.setUTCFullYear(nextDate.getUTCFullYear() + intervalCount);
            break;
          default:
            break;
        }
        currentPeriodEnd = Math.floor(nextDate.getTime() / 1000);
      }

      if (!detailRes.ok || !currentPeriodEnd) {
        console.error("[stripe] Failed to load subscription details for downgrade", {
          status: detailRes.status,
          body: detailData,
          subscriptionId: activeSub.id,
        });
        return NextResponse.json({ error: "stripe_subscription_error", message: "subscription_lookup_failed" }, { status: 500 });
      }
      const scheduleId =
        typeof detailData.schedule === "string"
          ? detailData.schedule
          : detailData.schedule?.id ?? null;

      console.info("[stripe] Downgrade start", {
        userId,
        subscriptionId: activeSub.id,
        scheduleId,
        currentPeriodStart,
        currentPeriodEnd,
        existingPriceId,
        targetPriceId: priceId,
      });

      let scheduleRef = scheduleId;
      if (!scheduleRef) {
        const scheduleCreate = await fetch("https://api.stripe.com/v1/subscription_schedules", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            from_subscription: activeSub.id,
          }).toString(),
        });
        const scheduleCreateData = (await scheduleCreate.json()) as { id?: string; error?: { message?: string } };
        if (!scheduleCreate.ok || !scheduleCreateData.id) {
          console.error("[stripe] Failed to create downgrade schedule (create)", {
            status: scheduleCreate.status,
            body: scheduleCreateData,
            subscriptionId: activeSub.id,
          });
          return NextResponse.json(
            { error: "stripe_subscription_error", message: scheduleCreateData?.error?.message ?? "schedule_create_failed" },
            { status: 500 }
          );
        }
        scheduleRef = scheduleCreateData.id;
      }

      const phaseParams = new URLSearchParams();
      if (currentPeriodStart) {
        phaseParams.append("phases[0][start_date]", String(currentPeriodStart));
      }
      phaseParams.append("end_behavior", "release");
      phaseParams.append("phases[0][end_date]", String(currentPeriodEnd));
      phaseParams.append("phases[0][items][0][price]", existingPriceId);
      phaseParams.append("phases[0][proration_behavior]", "none");
      phaseParams.append("phases[1][start_date]", String(currentPeriodEnd));
      phaseParams.append("phases[1][items][0][price]", priceId);
      phaseParams.append("phases[1][proration_behavior]", "none");
      phaseParams.append("phases[1][metadata][user_id]", userId);
      phaseParams.append("phases[1][metadata][plan]", plan);
      if (paymentMethodId) {
        phaseParams.append("phases[1][default_payment_method]", paymentMethodId);
      }

      const scheduleUpdate = await fetch(
        `https://api.stripe.com/v1/subscription_schedules/${scheduleRef}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: phaseParams.toString(),
        }
      );
      const scheduleUpdateData = (await scheduleUpdate.json()) as { id?: string; error?: { message?: string } };
      if (!scheduleUpdate.ok) {
        console.error("[stripe] Failed to update downgrade schedule phases", {
          status: scheduleUpdate.status,
          body: scheduleUpdateData,
          subscriptionId: activeSub.id,
          scheduleId: scheduleRef,
        });
        return NextResponse.json(
          { error: "stripe_subscription_error", message: scheduleUpdateData?.error?.message ?? "schedule_update_failed" },
          { status: 500 }
        );
      }

      console.info("[stripe] Downgrade scheduled", {
        userId,
        subscriptionId: activeSub.id,
        scheduleId: scheduleRef,
        switchAt: currentPeriodEnd,
      });

      return NextResponse.json({
        status: "scheduled",
        subscriptionId: activeSub.id,
        scheduleId: scheduleRef,
        switchAt: currentPeriodEnd,
      });
    }

    const createOrUpdateSubscription = async () => {
      if (!activeSub || !existingItemId) {
        const createParams = new URLSearchParams();
        createParams.append("customer", stripeCustomerId);
        createParams.append("items[0][price]", priceId);
        createParams.append("payment_behavior", "default_incomplete");
        createParams.append("payment_settings[save_default_payment_method]", "on_subscription");
        createParams.append("payment_settings[payment_method_types][0]", "card");
        if (paymentMethodId) {
          createParams.append("default_payment_method", paymentMethodId);
        }
        createParams.append("expand[]", "latest_invoice.payment_intent");
        createParams.append("metadata[user_id]", userId);
        createParams.append("metadata[plan]", plan);

        const createRes = await fetch("https://api.stripe.com/v1/subscriptions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: createParams.toString(),
        });
        const createData = (await createRes.json()) as {
          id?: string;
          latest_invoice?: { id?: string; payment_intent?: any };
        };
        if (!createRes.ok) {
          console.error("[stripe] Failed to create subscription for upgrade", {
            status: createRes.status,
            body: createData,
          });
          return { ok: false, data: createData };
        }
        return { ok: true, data: createData };
      }

      if (existingPriceId === priceId) {
        return { ok: true, data: { id: activeSub.id, latest_invoice: activeSub.latest_invoice } };
      }

      const updateParams = new URLSearchParams();
      updateParams.append("items[0][id]", existingItemId);
      updateParams.append("items[0][price]", priceId);
      if (isDowngrade) {
        updateParams.append("payment_behavior", "allow_incomplete");
        updateParams.append("proration_behavior", "none");
      } else {
        updateParams.append("payment_behavior", "default_incomplete");
        updateParams.append("proration_behavior", "create_prorations");
      }
      updateParams.append("cancel_at_period_end", "false");
      updateParams.append("payment_settings[save_default_payment_method]", "on_subscription");
      updateParams.append("payment_settings[payment_method_types][0]", "card");
      if (paymentMethodId) {
        updateParams.append("default_payment_method", paymentMethodId);
      }
      updateParams.append("expand[]", "latest_invoice.payment_intent");
      updateParams.append("metadata[user_id]", userId);
      updateParams.append("metadata[plan]", plan);

      const updateRes = await fetch(`https://api.stripe.com/v1/subscriptions/${activeSub.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: updateParams.toString(),
      });

      const updateData = (await updateRes.json()) as {
        id?: string;
        latest_invoice?: { id?: string; payment_intent?: any };
      };

      if (!updateRes.ok) {
        console.error("[stripe] Failed to upgrade subscription", {
          status: updateRes.status,
          body: updateData,
        });
        return { ok: false, data: updateData };
      }

      return { ok: true, data: updateData };
    };

    const { ok, data: updateData } = await createOrUpdateSubscription();
    if (!ok) {
      return NextResponse.json({ error: "stripe_subscription_error" }, { status: 500 });
    }

    type InvoiceData = { id?: string; status?: string; paid?: boolean; payment_intent?: any };

    const fetchInvoice = async (invoiceId: string) => {
      const invoiceRes = await fetch(
        `https://api.stripe.com/v1/invoices/${invoiceId}?expand[]=payment_intent`,
        { headers: { Authorization: `Bearer ${secretKey}` } }
      );
      const invoiceData = (await invoiceRes.json()) as InvoiceData;
      if (!invoiceRes.ok) {
        console.warn("[stripe] Failed to fetch invoice", { invoiceId, status: invoiceRes.status, body: invoiceData });
        return null;
      }
      return invoiceData;
    };

    let invoiceRef = updateData.latest_invoice;
    let invoice: InvoiceData | null =
      typeof invoiceRef === "string"
        ? await fetchInvoice(invoiceRef)
        : invoiceRef && typeof invoiceRef === "object"
        ? (invoiceRef as InvoiceData)
        : null;

    if (!isDowngrade && invoice && !invoice.payment_intent && invoice.id) {
      const finalizeRes = await fetch(
        `https://api.stripe.com/v1/invoices/${invoice.id}/finalize?expand[]=payment_intent`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${secretKey}` },
        }
      );
      const finalizeData = (await finalizeRes.json()) as InvoiceData;
      if (finalizeRes.ok) {
        invoice = finalizeData;
      } else {
        console.warn("[stripe] Failed to finalize invoice", {
          invoiceId: invoice.id,
          status: finalizeRes.status,
          body: finalizeData,
        });
      }
    }

    let paymentIntent = invoice?.payment_intent;
    let paymentIntentStatus =
      typeof paymentIntent === "object" ? paymentIntent?.status : undefined;
    const invoicePaid = Boolean(invoice?.paid) || invoice?.status === "paid";
    const paymentSettled =
      invoicePaid || paymentIntentStatus === "succeeded" || paymentIntentStatus === "processing";

    if (!isDowngrade && invoice && invoice.id && !paymentSettled) {
      const payParams = new URLSearchParams();
      if (paymentMethodId) {
        payParams.append("payment_method", paymentMethodId);
      }
      const payRes = await fetch(
        `https://api.stripe.com/v1/invoices/${invoice.id}/pay?expand[]=payment_intent`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: payParams.toString(),
        }
      );
      const payData = (await payRes.json()) as InvoiceData;
      if (payRes.ok) {
        invoice = payData;
        paymentIntent = invoice?.payment_intent;
        paymentIntentStatus =
          typeof paymentIntent === "object" ? paymentIntent?.status : paymentIntentStatus;
      } else {
        console.warn("[stripe] Failed to pay invoice", {
          invoiceId: invoice.id,
          status: payRes.status,
          body: payData,
        });
      }
    }
    const paymentIntentId =
      typeof paymentIntent === "object"
        ? paymentIntent?.id
        : typeof paymentIntent === "string"
        ? paymentIntent
        : undefined;
    const clientSecret =
      typeof paymentIntent === "object" ? paymentIntent?.client_secret : undefined;

    if (paymentIntentStatus === "requires_action") {
      return NextResponse.json({
        status: "requires_action",
        subscriptionId: updateData.id,
        clientSecret,
        paymentIntentId,
      });
    }

    if (paymentIntentStatus === "requires_payment_method") {
      return NextResponse.json({
        status: "payment_method_required",
        subscriptionId: updateData.id,
        clientSecret,
        paymentIntentId,
      });
    }

    // Downgrades: treat as succeeded immediately (no immediate charge).
    if (isDowngrade) {
      return NextResponse.json({
        status: "succeeded",
        subscriptionId: updateData.id,
        paymentIntentId,
      });
    }

    return NextResponse.json({
      status: paymentIntentStatus ?? (invoice?.paid ? "succeeded" : "processing"),
      subscriptionId: updateData.id,
      paymentIntentId,
    });
  } catch (error) {
    console.error("[stripe] Upgrade subscription error", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
