// src/app/api/orders/[id]/label/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { shippoRequest, shippoRatesMultiPiece } from "@/lib/shippo";
import type { FulfillmentStatus, LabelStatus } from "@prisma/client";
import { z } from "zod";

const LabelSchema = z.object({
  rateObjectId: z.string().min(1).optional().nullable(),
});

export const runtime = "nodejs";

type LiveRate = {
  label: string;
  amountCents: number;
  objectId: string;
  carrier?: string;
  service?: string;
  estDays?: number | null;
};

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
  const me = await prisma.user.findUnique({ where: { clerkId: clerkUserId } });
  if (!me) return null;

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
    const terminalStatuses: FulfillmentStatus[] = ["SHIPPED", "DELIVERED", "PICKED_UP"];
    if (terminalStatuses.includes(order.fulfillmentStatus)) {
      return NextResponse.json(
        { error: `Order is already in ${order.fulfillmentStatus} status.` },
        { status: 400 }
      );
    }

    // Determine which rate objectId to use:
    //   1. Caller supplied one explicitly (after a re-quote rate-picker selection)
    //   2. Stored rate is still valid (order under 5 days old)
    //   3. Neither → trigger re-quote
    const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
    const orderAge = Date.now() - order.createdAt.getTime();
    const storedRateUsable = !!order.shippoRateObjectId && orderAge < FIVE_DAYS_MS;
    const effectiveRateObjectId = bodyRateObjectId ?? (storedRateUsable ? order.shippoRateObjectId : null);

    if (!effectiveRateObjectId) {
      // Re-quote path
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

      // Persist updated shipmentId so the next call can reference these fresh rates
      await prisma.order.update({
        where: { id },
        data: { shippoShipmentId: shipmentId },
      });

      return NextResponse.json(
        { requiresRateSelection: true, shipmentId, rates: prioritized },
        { status: 202 }
      );
    }

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
      const msgs = (txn.messages || []).map((m) => m.text).join("; ");
      return NextResponse.json(
        { error: `Shippo label purchase failed: ${msgs || txn.status}` },
        { status: 502 }
      );
    }

    const labelCostCents = Math.round(Number(txn.rate?.amount ?? 0) * 100);
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
          });
        } catch (stripeErr) {
          console.warn(`Stripe label cost clawback failed for order ${id}:`, stripeErr);
        }
      }
    }

    return NextResponse.json({ ok: true, labelUrl: updated.labelUrl, order: updated });
  } catch (err) {
    console.error("POST /api/orders/[id]/label error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
