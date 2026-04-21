// src/app/api/shipping/quote/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { shippoRequest } from "@/lib/shippo";
import { signRate } from "@/lib/shipping-token";
import { shippingQuoteRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { z } from "zod";

const ShippingQuoteSchema = z.object({
  mode: z.enum(["cart", "single"]).optional(),
  cartId: z.string().min(1).optional().nullable(),
  sellerId: z.string().min(1).optional().nullable(),
  listingId: z.string().min(1).optional().nullable(),
  quantity: z.number().int().min(1).max(99).optional().nullable(),
  currency: z.string().max(3).optional().nullable(),
  // toPostal is required — it's signed into the HMAC and must match
  // what the buyer's checkout address submits. A default here would
  // cause every signature to mismatch on verification.
  toPostal: z.string().min(1).max(20),
  toState: z.string().max(50).optional().nullable(),
  toCity: z.string().max(100).optional().nullable(),
  toCountry: z.string().max(2).optional().nullable(),
});

export const runtime = "nodejs";

/**
 * POST /api/shipping/quote
 * Body:
 *   { mode: "cart", cartId: string, sellerId?: string, currency?: string, toPostal?, toState?, toCity?, toCountry? }
 *   OR
 *   { mode: "single", listingId: string, quantity?: number, currency?: string, toPostal?, toState?, toCity?, toCountry? }
 *
 * Response:
 *   { rates: [{ label, amountCents, carrier?, service?, estDays?, taxBehavior? }] }
 */
export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { success: rlOk, reset } = await safeRateLimit(shippingQuoteRatelimit, userId);
    if (!rlOk) return rateLimitResponse(reset, "Too many shipping quote requests.");

    // Resolve DB user for cart ownership check
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body;
    try {
      body = ShippingQuoteSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const mode = body.mode ?? "cart";
    const currency = (body.currency ?? "usd").toLowerCase();

    let sellerId: string | null = null;
    let sellerAllowsPickup = false;
    let totalWeightGrams = 0;
    let lengthCm: number | null = null;
    let widthCm: number | null = null;
    let heightCm: number | null = null;

    let shipFrom:
      | {
          name?: string | null;
          line1?: string | null;
          line2?: string | null;
          city?: string | null;
          state?: string | null;
          postal?: string | null;
          country?: string | null;
          defaults?: {
            weight?: number | null;
            len?: number | null;
            wid?: number | null;
            hgt?: number | null;
          };
        }
      | null = null;

    // toPostal is required by the Zod schema — the HMAC signing
    // below uses this exact value, and it must match what the
    // checkout route receives in body.shippingAddress.postalCode.
    const shipTo = {
      postal: body.toPostal,
      state: body.toState || "NY",
      city: body.toCity || "New York",
      country: body.toCountry || "US",
    };

    if (mode === "cart") {
      let cart;
      if (body.cartId) {
        cart = await prisma.cart.findUnique({
          where: { id: body.cartId },
          include: {
            items: {
              include: { listing: { include: { seller: true } } },
              where: body.sellerId ? { listing: { sellerId: body.sellerId } } : undefined,
            },
          },
        });
        if (cart && cart.userId !== me.id) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
      } else {
        cart = await prisma.cart.findFirst({
          where: { userId: me.id },
          include: {
            items: {
              include: { listing: { include: { seller: true } } },
              where: body.sellerId ? { listing: { sellerId: body.sellerId } } : undefined,
            },
          },
        });
      }
      if (!cart || cart.items.length === 0) {
        return NextResponse.json({ rates: [] });
      }
      sellerId = cart.items[0].listing.sellerId;

      // Load seller defaults + ship-from
      const seller = await prisma.sellerProfile.findUnique({
        where: { id: sellerId },
        select: {
          shipFromName: true,
          shipFromLine1: true,
          shipFromLine2: true,
          shipFromCity: true,
          shipFromState: true,
          shipFromPostal: true, // ✅ correct field
          shipFromCountry: true,
          defaultPkgWeightGrams: true,
          defaultPkgLengthCm: true,
          defaultPkgWidthCm: true,
          defaultPkgHeightCm: true,
          allowLocalPickup: true,
        },
      });

      if (!seller) return NextResponse.json({ rates: [] });

      sellerAllowsPickup = seller.allowLocalPickup;

      shipFrom = {
        name: seller.shipFromName,
        line1: seller.shipFromLine1,
        line2: seller.shipFromLine2,
        city: seller.shipFromCity,
        state: seller.shipFromState,
        postal: seller.shipFromPostal ?? undefined,
        country: seller.shipFromCountry ?? "US",
        defaults: {
          weight: seller.defaultPkgWeightGrams ?? null,
          len: seller.defaultPkgLengthCm ?? null,
          wid: seller.defaultPkgWidthCm ?? null,
          hgt: seller.defaultPkgHeightCm ?? null,
        },
      };

      // Aggregate: sum weights, take max dims (simple heuristic)
      for (const it of cart.items) {
        const qty = it.quantity;
        const L = it.listing;
        const w = L.packagedWeightGrams ?? seller.defaultPkgWeightGrams ?? 0;
        const l = L.packagedLengthCm ?? seller.defaultPkgLengthCm ?? 0;
        const wi = L.packagedWidthCm ?? seller.defaultPkgWidthCm ?? 0;
        const h = L.packagedHeightCm ?? seller.defaultPkgHeightCm ?? 0;

        totalWeightGrams += w * qty;
        lengthCm = Math.max(lengthCm ?? 0, l);
        widthCm = Math.max(widthCm ?? 0, wi);
        heightCm = Math.max(heightCm ?? 0, h);
      }
    } else if (mode === "single") {
      const listing = await prisma.listing.findUnique({
        where: { id: body.listingId ?? "" },
        include: { seller: true },
      });
      if (!listing) return NextResponse.json({ rates: [] });

      sellerId = listing.sellerId;

      const seller = await prisma.sellerProfile.findUnique({
        where: { id: sellerId },
        select: {
          shipFromName: true,
          shipFromLine1: true,
          shipFromLine2: true,
          shipFromCity: true,
          shipFromState: true,
          shipFromPostal: true, // ✅ correct field
          shipFromCountry: true,
          defaultPkgWeightGrams: true,
          defaultPkgLengthCm: true,
          defaultPkgWidthCm: true,
          defaultPkgHeightCm: true,
          allowLocalPickup: true,
        },
      });

      if (!seller) return NextResponse.json({ rates: [] });

      sellerAllowsPickup = seller.allowLocalPickup;

      shipFrom = {
        name: seller.shipFromName,
        line1: seller.shipFromLine1,
        line2: seller.shipFromLine2,
        city: seller.shipFromCity,
        state: seller.shipFromState,
        postal: seller.shipFromPostal ?? undefined,
        country: seller.shipFromCountry ?? "US",
        defaults: {
          weight: seller.defaultPkgWeightGrams ?? null,
          len: seller.defaultPkgLengthCm ?? null,
          wid: seller.defaultPkgWidthCm ?? null,
          hgt: seller.defaultPkgHeightCm ?? null,
        },
      };

      const qty = Math.max(1, body.quantity ?? 1);
      const w = listing.packagedWeightGrams ?? seller.defaultPkgWeightGrams ?? 0;
      const l = listing.packagedLengthCm ?? seller.defaultPkgLengthCm ?? 0;
      const wi = listing.packagedWidthCm ?? seller.defaultPkgWidthCm ?? 0;
      const h = listing.packagedHeightCm ?? seller.defaultPkgHeightCm ?? 0;

      totalWeightGrams = w * qty;
      lengthCm = l;
      widthCm = wi;
      heightCm = h;
    } else {
      return NextResponse.json({ error: "Bad mode" }, { status: 400 });
    }

    // Need a valid ship-from + nonzero package
    if (
      !shipFrom?.line1 ||
      !shipFrom.city ||
      !shipFrom.state ||
      !shipFrom.postal ||
      !shipFrom.country
    ) {
      return NextResponse.json({ rates: [] });
    }
    if (!totalWeightGrams || !lengthCm || !widthCm || !heightCm) {
      return NextResponse.json({ rates: [] });
    }

    type ShippoRate = { currency?: string; provider?: string; carrier?: string; servicelevel?: { name?: string }; service?: string; estimated_days?: number | null; amount?: number; object_id?: string };
    type ShippoShipment = { rates?: ShippoRate[] };
    // Build Shippo shipment + fetch rates (async=false embeds rates)
    const shipment = await shippoRequest<ShippoShipment>("/shipments/", {
      method: "POST",
      body: JSON.stringify({
        address_from: {
          name: shipFrom.name || undefined,
          street1: shipFrom.line1,
          street2: shipFrom.line2 || undefined,
          city: shipFrom.city,
          state: shipFrom.state,
          zip: shipFrom.postal,
          country: shipFrom.country,
        },
        address_to: {
          // For better quotes, pass real buyer destination when available.
          street1: "Placeholder",
          city: shipTo.city,
          state: shipTo.state,
          zip: shipTo.postal,
          country: shipTo.country,
        },
        parcels: [
          {
            length: lengthCm,
            width: widthCm,
            height: heightCm,
            distance_unit: "cm",
            weight: totalWeightGrams,
            mass_unit: "g",
          },
        ],
        async: false,
      }),
    });

    const rates = Array.isArray(shipment?.rates) ? shipment.rates : [];

    // contextId ties the HMAC signature to either the seller (cart)
    // or the specific listing (buy-now). This prevents a cheap rate
    // signed for one seller/listing from being replayed against another.
    // sellerId is resolved above in both branches.
    const contextId: string =
      mode === "single" ? (body.listingId ?? "") : (sellerId ?? "");

    const out = rates
      .filter((r) => String(r.currency || "").toLowerCase() === currency)
      .slice(0, 12)
      .map((r) => {
        const label = `${r.provider || r.carrier} ${r.servicelevel?.name || r.service} (${
          r.estimated_days ? `${r.estimated_days}d` : "—"
        })`;
        const amountCents = Math.round(Number(r.amount) * 100);
        const carrier = r.provider || r.carrier || "";
        const service = r.servicelevel?.name || r.service || "";
        const estDays = r.estimated_days ?? null;
        const objectId = r.object_id ?? null;

        const { token, expiresAt } = signRate({
          objectId: objectId ?? "",
          amountCents,
          displayName: label,
          carrier,
          estDays,
          contextId,
          buyerPostal: shipTo.postal,
        });

        return {
          label,
          amountCents,
          carrier,
          service,
          estDays,
          taxBehavior: "exclusive" as const,
          objectId,
          token,
          expiresAt,
        };
      });

    // Local pickup option — injected as a synthetic rate if seller allows it
    if (sellerAllowsPickup) {
      const pickupLabel = "Local Pickup (Free)";
      const { token: pickupToken, expiresAt: pickupExpiresAt } = signRate({
        objectId: "pickup",
        amountCents: 0,
        displayName: pickupLabel,
        carrier: "pickup",
        estDays: null,
        contextId,
        buyerPostal: shipTo.postal,
      });
      out.unshift({
        label: pickupLabel,
        amountCents: 0,
        carrier: "pickup",
        service: "pickup",
        estDays: null,
        taxBehavior: "exclusive" as const,
        objectId: "pickup",
        token: pickupToken,
        expiresAt: pickupExpiresAt,
      });
    }

    return NextResponse.json({ rates: out });
  } catch (err) {
    console.error("POST /api/shipping/quote error:", err);
    // Don’t break checkout; returning [] lets the caller fall back to flat/pickup.
    return NextResponse.json({ rates: [] });
  }
}


