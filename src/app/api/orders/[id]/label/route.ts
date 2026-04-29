// src/app/api/orders/[id]/label/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { shippoRequest, shippoRatesMultiPiece } from "@/lib/shippo";
import { labelPurchaseRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { orderHasRefundLedger } from "@/lib/refundRouteState";
import type { FulfillmentStatus, LabelStatus, Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

const LabelSchema = z.object({
  rateObjectId: z.string().min(1).optional().nullable(),
});

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

type LiveRate = {
  label: string;
  amountCents: number;
  objectId: string;
  carrier?: string;
  service?: string;
  estDays?: number | null;
};

const ACTIVE_CASE_STATUSES = new Set(["OPEN", "IN_DISCUSSION", "PENDING_CLOSE", "UNDER_REVIEW"]);
const LABEL_RATE_QUOTE_TTL_MS = 30 * 60 * 1000;

function isPurchasableRateObjectId(rateObjectId: string | null | undefined): rateObjectId is string {
  return !!rateObjectId && rateObjectId !== "fallback" && rateObjectId !== "pickup";
}

function rateSetIncludes(rates: Prisma.JsonValue, rateObjectId: string): boolean {
  if (!Array.isArray(rates)) return false;
  return rates.some((rate) => {
    if (!rate || typeof rate !== "object" || Array.isArray(rate)) return false;
    return "objectId" in rate && rate.objectId === rateObjectId;
  });
}

function prioritizeAndTrim(rates: LiveRate[], max = 4): LiveRate[] {
  if (!Array.isArray(rates) || rates.length === 0) return [];
  const scored = rates.map((r) => {
    const isUps = (r.carrier || "").toLowerCase().includes("ups");
    const isGround =
      (r.service || "").toLowerCase().includes("ground") ||
      r.label.toLowerCase().includes("ground");
    return { ...r, __boost: isUps && isGround ? 1 : 0 };
  });
  scored.sort((a, b) => {
    if (b.__boost !== a.__boost) return b.__boost - a.__boost;
    if (a.amountCents !== b.amountCents) return a.amountCents - b.amountCents;
    return (a.estDays ?? 999) - (b.estDays ?? 999);
  });
  const seen = new Set<string>();
  const out: (LiveRate & { __boost: number })[] = [];
  for (const r of scored) {
    const key = `${(r.carrier || "").toLowerCase()}|${(r.service || r.label).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= max) break;
  }
  return out.map(({ __boost, ...rest }) => rest);
}

async function ensureSellerOwnsOrder(clerkUserId: string, orderId: string) {
  const me = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me || me.banned || me.deletedAt) return null;

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: {
      id: true,
      stripeAccountId: true,
      shipFromName: true,
      shipFromLine1: true,
      shipFromLine2: true,
      shipFromCity: true,
      shipFromState: true,
      shipFromPostal: true,
      shipFromCountry: true,
      defaultPkgWeightGrams: true,
      defaultPkgLengthCm: true,
      defaultPkgWidthCm: true,
      defaultPkgHeightCm: true,
    },
  });
  if (!seller) return null;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      case: { select: { status: true } },
      paymentEvents: {
        where: { eventType: "REFUND" },
        take: 1,
        select: { eventType: true },
      },
      items: {
        include: {
          listing: {
            select: {
              sellerId: true,
              packagedWeightGrams: true,
              packagedLengthCm: true,
              packagedWidthCm: true,
              packagedHeightCm: true,
            },
          },
        },
      },
    },
  });
  if (!order) return null;

  const ownsAny = order.items.some((it) => it.listing.sellerId === seller.id);
  return ownsAny ? { order, seller } : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { success, reset } = await safeRateLimit(labelPurchaseRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many label purchase attempts.");

    const authz = await ensureSellerOwnsOrder(userId, id);
    if (!authz) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { order, seller } = authz;

    // Parse optional body — frontend may supply rateObjectId after a re-quote
    let labelParsed: { rateObjectId?: string | null | undefined } = {};
    try {
      labelParsed = LabelSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      // empty body is fine — treat as no rateObjectId
    }
    const bodyRateObjectId: string | null = labelParsed?.rateObjectId ?? null;

    // Guard rails
    if (order.labelStatus === ("PURCHASED" as LabelStatus)) {
      return NextResponse.json(
        { error: "Label already purchased for this order." },
        { status: 400 }
      );
    }
    // Block label purchase if order has been refunded or has an open case
    if (orderHasRefundLedger(order)) {
      return NextResponse.json({ error: "Cannot purchase label — order has been refunded." }, { status: 400 });
    }
    if (order.fulfillmentMethod === "PICKUP") {
      return NextResponse.json({ error: "Cannot purchase a shipping label for a pickup order." }, { status: 400 });
    }
    if (order.case && ACTIVE_CASE_STATUSES.has(order.case.status)) {
      return NextResponse.json({ error: "Cannot purchase a label while this order has an active case." }, { status: 400 });
    }
    const terminalStatuses: FulfillmentStatus[] = ["SHIPPED", "DELIVERED", "PICKED_UP"];
    if (terminalStatuses.includes(order.fulfillmentStatus)) {
      return NextResponse.json(
        { error: `Order is already in ${order.fulfillmentStatus} status.` },
        { status: 400 }
      );
    }

    // Determine which rate objectId to use:
    //   1. Caller supplied one explicitly and it belongs to the order's
    //      unexpired persisted quote set
    //   2. Stored rate is still valid (order under 5 days old)
    //   3. Neither → trigger re-quote
    const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
    const orderAge = Date.now() - order.createdAt.getTime();
    const storedRateUsable = isPurchasableRateObjectId(order.shippoRateObjectId) && orderAge < FIVE_DAYS_MS;
    let effectiveRateObjectId: string | null = null;

    if (bodyRateObjectId) {
      if (!isPurchasableRateObjectId(bodyRateObjectId)) {
        return NextResponse.json({ error: "Invalid shipping rate selected." }, { status: 400 });
      }
      if (storedRateUsable && bodyRateObjectId === order.shippoRateObjectId) {
        effectiveRateObjectId = bodyRateObjectId;
      } else {
        const quoteSet = await prisma.orderShippingRateQuote.findFirst({
          where: { orderId: order.id, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "desc" },
          select: { rates: true },
        });
        if (!quoteSet || !rateSetIncludes(quoteSet.rates, bodyRateObjectId)) {
          return NextResponse.json(
            { error: "Shipping rate expired. Re-quote before purchasing a label." },
            { status: 400 },
          );
        }
        effectiveRateObjectId = bodyRateObjectId;
      }
    } else if (storedRateUsable) {
      effectiveRateObjectId = order.shippoRateObjectId;
    }

    if (!effectiveRateObjectId) {
      if (!order.shipToLine1 || !order.shipToCity || !order.shipToState || !order.shipToPostalCode) {
        return NextResponse.json(
          { error: "Order is missing shipping address fields required for re-quoting." },
          { status: 400 }
        );
      }
      if (!seller.shipFromLine1 || !seller.shipFromCity || !seller.shipFromState || !seller.shipFromPostal) {
        return NextResponse.json(
          { error: "Seller ship-from address is incomplete. Update it in seller settings." },
          { status: 400 }
        );
      }

      let totalWeightGrams = 0;
      let lengthCm = 0;
      let widthCm = 0;
      let heightCm = 0;
      for (const it of order.items) {
        const L = it.listing;
        totalWeightGrams +=
          Number(L.packagedWeightGrams ?? seller.defaultPkgWeightGrams ?? 0) * it.quantity;
        lengthCm = Math.max(lengthCm, Number(L.packagedLengthCm ?? seller.defaultPkgLengthCm ?? 0));
        widthCm  = Math.max(widthCm,  Number(L.packagedWidthCm  ?? seller.defaultPkgWidthCm  ?? 0));
        heightCm = Math.max(heightCm, Number(L.packagedHeightCm ?? seller.defaultPkgHeightCm ?? 0));
      }

      const { rates: rawRates, shipmentId } = await shippoRatesMultiPiece({
        from: {
          name: seller.shipFromName ?? undefined,
          street1: seller.shipFromLine1,
          street2: seller.shipFromLine2 ?? undefined,
          city: seller.shipFromCity,
          state: seller.shipFromState,
          zip: seller.shipFromPostal,
          country: seller.shipFromCountry ?? "US",
        },
        to: {
          street1: order.shipToLine1,
          street2: order.shipToLine2 ?? undefined,
          city: order.shipToCity,
          state: order.shipToState,
          zip: order.shipToPostalCode,
          country: order.shipToCountry ?? "US",
        },
        parcels: [
          {
            weight: { value: totalWeightGrams, unit: "g" },
            length: lengthCm ? String(lengthCm) : undefined,
            width:  widthCm  ? String(widthCm)  : undefined,
            height: heightCm ? String(heightCm) : undefined,
          },
        ],
      });

      type RawRate = { provider?: string; servicelevel_name?: string; est_days?: number | null; amount: number; objectId?: string };
      const liveRates: LiveRate[] = (rawRates as RawRate[]).map((r) => ({
        label: `${r.provider} ${r.servicelevel_name} (${r.est_days ? `${r.est_days}d` : "—"})`,
        amountCents: r.amount,
        objectId: r.objectId || "",
        carrier: r.provider,
        service: r.servicelevel_name,
        estDays: r.est_days ?? null,
      }));

      const prioritized = prioritizeAndTrim(liveRates, 4);
      if (prioritized.length === 0) {
        return NextResponse.json(
          { error: "No current shipping label rates are available for this order." },
          { status: 502 },
        );
      }

      await prisma.$transaction([
        prisma.order.update({
          where: { id },
          data: { shippoShipmentId: shipmentId },
        }),
        prisma.orderShippingRateQuote.create({
          data: {
            orderId: id,
            shipmentId,
            rates: prioritized,
            expiresAt: new Date(Date.now() + LABEL_RATE_QUOTE_TTL_MS),
          },
        }),
        prisma.orderShippingRateQuote.deleteMany({
          where: { orderId: id, expiresAt: { lt: new Date() } },
        }),
      ]);

      return NextResponse.json(
        { requiresRateSelection: true, shipmentId, rates: prioritized },
        { status: 202 }
      );
    }

    // Atomic double-check to prevent concurrent label purchases. We set the
    // terminal label status before Shippo purchase so retries cannot buy a
    // second label if Shippo succeeds but a later DB write fails.
    const labelLockResult: number = await prisma.$executeRaw`
      UPDATE "Order" SET "labelStatus" = 'PURCHASED'::"LabelStatus"
      WHERE id = ${order.id} AND ("labelStatus" IS NULL OR "labelStatus" != 'PURCHASED'::"LabelStatus")
        AND "fulfillmentStatus" = 'PENDING'::"FulfillmentStatus"
        AND "sellerRefundId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "OrderPaymentEvent" ope
          WHERE ope."orderId" = "Order".id
            AND ope."eventType" = 'REFUND'
        )
    `;
    if (labelLockResult === 0) {
      return NextResponse.json({ error: "Label already purchased or order status changed." }, { status: 400 });
    }

    const revertLabelLock = async () => {
      await prisma.$executeRaw`
        UPDATE "Order" SET "labelStatus" = NULL
        WHERE id = ${order.id}
      `.catch(() => {});
    };

    let shippoPurchaseSucceeded = false;
    let purchasedLabelDetails: {
      transactionId?: string;
      labelUrl?: string;
      trackingNumber?: string;
      carrier?: string;
      labelCostCents?: number;
    } | null = null;

    try {

    type ShippoTransaction = {
      status: string;
      messages?: { text: string }[];
      object_id?: string;
      label_url?: string;
      tracking_number?: string;
      rate?: { amount?: number; provider?: string };
    };
    // Purchase the label using the resolved rate objectId
    const txn = await shippoRequest<ShippoTransaction>("/transactions/", {
      method: "POST",
      body: JSON.stringify({
        rate: effectiveRateObjectId,
        label_file_type: "PDF",
        async: false,
      }),
    });

    if (txn.status !== "SUCCESS") {
      // Revert lock — label purchase did not succeed
      await revertLabelLock();
      const msgs = (txn.messages || []).map((m) => m.text).join("; ");
      return NextResponse.json(
        { error: `Shippo label purchase failed: ${msgs || txn.status}` },
        { status: 502 }
      );
    }
    shippoPurchaseSucceeded = true;

    const labelCostCents = Math.round(Number(txn.rate?.amount ?? 0) * 100);
    purchasedLabelDetails = {
      transactionId: txn.object_id,
      labelUrl: txn.label_url,
      trackingNumber: txn.tracking_number,
      carrier: txn.rate?.provider,
      labelCostCents,
    };
    const now = new Date();

    const updated = await prisma.order.update({
      where: { id },
      data: {
        shippoTransactionId: txn.object_id,
        labelUrl: txn.label_url,
        labelCarrier: txn.rate?.provider ?? null,
        labelTrackingNumber: txn.tracking_number ?? null,
        labelCostCents,
        labelStatus: "PURCHASED",
        labelPurchasedAt: now,
        fulfillmentStatus: "SHIPPED",
        shippedAt: now,
        trackingNumber: txn.tracking_number ?? null,
        trackingCarrier: txn.rate?.provider ?? null,
      },
    });

    // Best-effort: claw back label cost by reversing part of the seller's transfer
    if (labelCostCents > 0) {
      if (!order.stripeTransferId) {
        console.warn(
          `Order ${id} has no stripeTransferId — label cost clawback of ${labelCostCents} cents must be handled manually.`
        );
      } else {
        try {
          await stripe.transfers.createReversal(order.stripeTransferId, {
            amount: labelCostCents,
            metadata: { orderId: id, reason: "label_cost_deduction" },
          }, {
            idempotencyKey: `label-cost:${id}:${txn.object_id ?? effectiveRateObjectId}:${labelCostCents}`,
          });
        } catch (stripeErr) {
          console.warn(`Stripe label cost clawback failed for order ${id}:`, stripeErr);
          Sentry.captureException(stripeErr, {
            tags: { source: "label_cost_clawback" },
            extra: { orderId: id, stripeTransferId: order.stripeTransferId, labelCostCents },
          });
        }
      }
    }

    return NextResponse.json({ ok: true, labelUrl: updated.labelUrl, order: updated });
    } catch (labelErr) {
      if (!shippoPurchaseSucceeded) {
        await revertLabelLock();
      } else {
        Sentry.captureException(labelErr, {
          tags: { source: "shippo_label_post_purchase_db_update" },
          extra: { orderId: id, purchasedLabelDetails },
        });
        await prisma.order.updateMany({
          where: { id, labelStatus: "PURCHASED" },
          data: {
            reviewNeeded: true,
            reviewNote: `ORPHANED LABEL: Shippo label ${purchasedLabelDetails?.transactionId ?? "unknown"} may have been purchased, but follow-up DB work failed. Manual reconciliation required.`,
            ...(purchasedLabelDetails?.transactionId ? { shippoTransactionId: purchasedLabelDetails.transactionId } : {}),
            ...(purchasedLabelDetails?.labelUrl ? { labelUrl: purchasedLabelDetails.labelUrl } : {}),
            ...(purchasedLabelDetails?.trackingNumber ? {
              labelTrackingNumber: purchasedLabelDetails.trackingNumber,
              trackingNumber: purchasedLabelDetails.trackingNumber,
            } : {}),
            ...(purchasedLabelDetails?.carrier ? {
              labelCarrier: purchasedLabelDetails.carrier,
              trackingCarrier: purchasedLabelDetails.carrier,
            } : {}),
            ...(typeof purchasedLabelDetails?.labelCostCents === "number" ? { labelCostCents: purchasedLabelDetails.labelCostCents } : {}),
          },
        }).catch(() => {});
      }
      throw labelErr;
    }
  } catch (err) {
    console.error("POST /api/orders/[id]/label error:", err);
    Sentry.captureException(err, { tags: { source: "label_purchase" } });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
