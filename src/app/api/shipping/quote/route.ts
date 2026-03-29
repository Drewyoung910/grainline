// src/app/api/shipping/quote/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shippoRequest } from "@/lib/shippo";

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
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || "cart");
    const currency = String(body.currency || "usd").toLowerCase();

    let sellerId: string | null = null;
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

    // If you pass buyer destination in body, we’ll use it; else a NYC placeholder.
    const shipTo = {
      postal: body.toPostal || "10001",
      state: body.toState || "NY",
      city: body.toCity || "New York",
      country: body.toCountry || "US",
    };

    if (mode === "cart") {
      const cart = await prisma.cart.findUnique({
        where: { id: String(body.cartId || "") },
        include: {
          items: {
            include: { listing: { include: { seller: true } } },
            where: body.sellerId
              ? { listing: { sellerId: String(body.sellerId) } }
              : undefined,
          },
        },
      });
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
        },
      });

      if (!seller) return NextResponse.json({ rates: [] });

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
        where: { id: String(body.listingId || "") },
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
        },
      });

      if (!seller) return NextResponse.json({ rates: [] });

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

      const qty = Math.max(1, Number(body.quantity || 1));
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

    type ShippoRate = { currency?: string; provider?: string; carrier?: string; servicelevel?: { name?: string }; service?: string; estimated_days?: number | null; amount?: number };
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

    const out = rates
      .filter((r) => String(r.currency || "").toLowerCase() === currency)
      .slice(0, 12)
      .map((r) => ({
        label: `${r.provider || r.carrier} ${r.servicelevel?.name || r.service} (${
          r.estimated_days ? `${r.estimated_days}d` : "—"
        })`,
        amountCents: Math.round(Number(r.amount) * 100),
        carrier: r.provider || r.carrier,
        service: r.servicelevel?.name || r.service,
        estDays: r.estimated_days ?? null,
        taxBehavior: "exclusive" as const,
      }));

    return NextResponse.json({ rates: out });
  } catch (err) {
    console.error("POST /api/shipping/quote error:", err);
    // Don’t break checkout; returning [] lets the caller fall back to flat/pickup.
    return NextResponse.json({ rates: [] });
  }
}


