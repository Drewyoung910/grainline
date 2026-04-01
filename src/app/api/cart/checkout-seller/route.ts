// src/app/api/cart/checkout-seller/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { shippoRatesMultiPiece } from "@/lib/shippo";

export const runtime = "nodejs";

type LiveRate = {
  label: string;
  amountCents: number;
  objectId?: string;
  carrier?: string;
  service?: string;
  estDays?: number | null;
  taxBehavior?: "exclusive" | "inclusive";
};

function prioritizeAndTrim(rates: LiveRate[], max = 5): LiveRate[] {
  if (!Array.isArray(rates) || rates.length === 0) return [];
  const scored = rates.map((r) => {
    const isUps = (r.carrier || "").toLowerCase().includes("ups");
    const isGround =
      (r.service || "").toLowerCase().includes("ground") ||
      r.label.toLowerCase().includes("ground");
    const boost = isUps && isGround ? 1 : 0;
    return { ...r, __boost: boost };
  });
  scored.sort((a, b) => {
    if (b.__boost !== a.__boost) return b.__boost - a.__boost; // UPS Ground first
    if (a.amountCents !== b.amountCents) return a.amountCents - b.amountCents; // cheapest next
    const ad = a.estDays ?? 999, bd = b.estDays ?? 999;
    return ad - bd; // then fastest
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

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    const me = await ensureUserByClerkId(userId);

    // Body: { sellerId, useCalculated?: boolean, toPostal?, toState?, toCity?, toCountry? }
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch {}
    const sellerId = String(body?.sellerId || "");
    if (!sellerId) return NextResponse.json({ error: "Missing sellerId" }, { status: 400 });

    const giftNote: string = body?.giftNote ? String(body.giftNote).slice(0, 200) : "";
    const giftWrapping: boolean = body?.giftWrapping === true || body?.giftWrapping === "true";
    const giftWrappingPriceCentsRaw = Number(body?.giftWrappingPriceCents ?? 0);
    const giftWrappingPriceCents: number = Number.isFinite(giftWrappingPriceCentsRaw) && giftWrappingPriceCentsRaw > 0
      ? Math.round(giftWrappingPriceCentsRaw)
      : 0;

    const toPostal  = body?.toPostal  ? String(body.toPostal)  : undefined;
    const toState   = body?.toState   ? String(body.toState)   : undefined;
    const toCity    = body?.toCity    ? String(body.toCity)    : undefined;
    const toCountry = body?.toCountry ? String(body.toCountry) : "US";

    // Load cart (filter items to this seller)
    const cart = await prisma.cart.findUnique({
      where: { userId: me.id },
      include: {
        items: {
          include: { listing: { include: { seller: true, photos: true } } },
        },
      },
    });
    if (!cart) return NextResponse.json({ error: "Cart is empty" }, { status: 400 });

    const sellerItems = cart.items.filter((it) => it.listing.sellerId === sellerId);
    if (sellerItems.length === 0) {
      return NextResponse.json({ error: "No items for this seller" }, { status: 400 });
    }

    const currency = (sellerItems[0].listing.currency || "usd").toLowerCase();
    const destination = sellerItems[0].listing.seller.stripeAccountId || null;

    // Seller shipping prefs (flat/free/pickup + toggle)
    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { id: sellerId },
      select: {
        shippingFlatRate: true,
        freeShippingOver: true,
        allowLocalPickup: true,
        useCalculatedShipping: true,
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

    const useCalculated =
      typeof body?.useCalculated === "boolean"
        ? body.useCalculated
        : !!sellerProfile?.useCalculatedShipping;

    // Stripe line items
    const line_items: {
      quantity: number;
      price_data: { currency: string; unit_amount: number; product_data: { name: string; images?: string[]; metadata?: Record<string, string> } };
    }[] = sellerItems.map((i) => ({
      quantity: i.quantity,
      price_data: {
        currency,
        unit_amount: i.priceCents,
        product_data: {
          name: i.listing.title,
          images: i.listing.photos?.length ? [i.listing.photos[0]!.url] : undefined,
          metadata: { listingId: i.listing.id },
        },
      },
    }));

    if (giftWrapping && giftWrappingPriceCents > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: giftWrappingPriceCents,
          product_data: { name: "Gift Wrapping" },
        },
      });
    }

    const itemsSubtotalCents = sellerItems.reduce(
      (sum, it) => sum + it.priceCents * it.quantity,
      0
    );

    // Live rates via direct Shippo call
    let liveRates: LiveRate[] = [];
    let shippoShipmentId: string | undefined;
    if (useCalculated) {
      try {
        const sp = sellerProfile;
        if (sp?.shipFromLine1 && sp.shipFromCity && sp.shipFromState && sp.shipFromPostal) {
          // Aggregate: sum weights, take max dims across all seller items
          let totalWeightGrams = 0;
          let lengthCm = 0;
          let widthCm = 0;
          let heightCm = 0;
          for (const it of sellerItems) {
            const L = it.listing;
            totalWeightGrams += (L.packagedWeightGrams ?? sp.defaultPkgWeightGrams ?? 0) * it.quantity;
            lengthCm = Math.max(lengthCm, L.packagedLengthCm ?? sp.defaultPkgLengthCm ?? 0);
            widthCm  = Math.max(widthCm,  L.packagedWidthCm  ?? sp.defaultPkgWidthCm  ?? 0);
            heightCm = Math.max(heightCm, L.packagedHeightCm ?? sp.defaultPkgHeightCm ?? 0);
          }

          if (totalWeightGrams > 0 && lengthCm > 0 && widthCm > 0 && heightCm > 0) {
            const { rates: rawRates, shipmentId: fetchedShipmentId } = await shippoRatesMultiPiece({
              from: {
                name: sp.shipFromName ?? undefined,
                street1: sp.shipFromLine1,
                street2: sp.shipFromLine2 ?? undefined,
                city: sp.shipFromCity,
                state: sp.shipFromState,
                zip: sp.shipFromPostal,
                country: sp.shipFromCountry ?? "US",
              },
              to: {
                street1: "Placeholder",
                city: toCity ?? "New York",
                state: toState ?? "NY",
                zip: toPostal ?? "10001",
                country: toCountry ?? "US",
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

            shippoShipmentId = fetchedShipmentId;
            type RawRate = { currency?: string; provider?: string; servicelevel_name?: string; est_days?: number | null; amount: number; objectId?: string };
            liveRates = (rawRates as RawRate[])
              .filter((r) => (r.currency || "").toLowerCase() === currency)
              .slice(0, 12)
              .map((r) => ({
                label: `${r.provider} ${r.servicelevel_name} (${r.est_days ? `${r.est_days}d` : "—"})`,
                amountCents: r.amount, // already converted to cents by shippoRatesMultiPiece
                objectId: r.objectId || "",
                carrier: r.provider,
                service: r.servicelevel_name,
                estDays: r.est_days ?? null,
                taxBehavior: "exclusive" as const,
              }));
          }
        }
      } catch (e) {
        console.warn("Shippo quote failed; will fall back to flat/pickup", e);
      }
    }

    const shipping_options: Record<string, unknown>[] = [];
    let quotedAmountCents: number | undefined;
    let quotedLabel: string | undefined;
    let quotedCarrier: string | undefined;
    let quotedService: string | undefined;

    if (useCalculated && liveRates.length > 0) {
      // Keep ≤4 live rates so there's always room for pickup (Stripe max 5)
      const best = prioritizeAndTrim(liveRates, 4);
      best.forEach((r, idx) => {
        if (idx === 0) {
          quotedAmountCents = r.amountCents;
          quotedLabel = r.label;
          quotedCarrier = r.carrier;
          quotedService = r.service;
        }
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: r.amountCents, currency },
            display_name: r.label,
            tax_behavior: r.taxBehavior || "exclusive",
            metadata: { objectId: r.objectId || "", estDays: r.estDays != null ? String(r.estDays) : "" },
          },
        });
      });

      if (sellerProfile?.allowLocalPickup) {
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 0, currency },
            display_name: "Local pickup (no shipping)",
            tax_behavior: "exclusive",
          },
        });
      }
    } else {
      // Flat / Free / Pickup path
      const flatDollars = sellerProfile?.shippingFlatRate ?? null;
      const freeOverDollars = sellerProfile?.freeShippingOver ?? null;
      const allowPickup = !!sellerProfile?.allowLocalPickup;

      if (
        freeOverDollars != null &&
        Number.isFinite(freeOverDollars) &&
        itemsSubtotalCents >= Math.round(freeOverDollars * 100)
      ) {
        const amt = 0;
        if (quotedAmountCents === undefined) quotedAmountCents = amt;
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: amt, currency },
            display_name: "Free shipping",
            tax_behavior: "exclusive",
          },
        });
      }

      if (flatDollars != null && Number.isFinite(flatDollars) && flatDollars >= 0) {
        const amt = Math.round(flatDollars * 100);
        if (quotedAmountCents === undefined) quotedAmountCents = amt;
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: amt, currency },
            display_name: "Flat shipping",
            tax_behavior: "exclusive",
          },
        });
      }

      if (allowPickup) {
        const amt = 0;
        if (quotedAmountCents === undefined) quotedAmountCents = amt;
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: amt, currency },
            display_name: "Local pickup (no shipping)",
            tax_behavior: "exclusive",
          },
        });
      }

      if (shipping_options.length === 0) {
        const amt = 0;
        quotedAmountCents = amt;
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: amt, currency },
            display_name: "Local pickup (no shipping)",
            tax_behavior: "exclusive",
          },
        });
      }
    }

    const capped_shipping_options = shipping_options.slice(0, 5);

    const success_url = `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${process.env.NEXT_PUBLIC_APP_URL}/cart`;

    const base: Record<string, unknown> = {
      mode: "payment",
      success_url,
      cancel_url,
      line_items,
      billing_address_collection: "auto",
      shipping_address_collection: { allowed_countries: ["US"] },
      automatic_tax: { enabled: true },
      shipping_options: capped_shipping_options,
      metadata: {
        cartId: cart.id,
        buyerId: me.id,
        sellerId,
        useCalculated: String(!!useCalculated),

        // snapshot the address we quoted against
        quotedShipToPostalCode: toPostal || "",
        quotedShipToState: toState || "",
        quotedShipToCity: toCity || "",
        quotedShipToCountry: toCountry || "US",

        // snapshot the rate we showed as "quoted"
        quotedShippingAmountCents: quotedAmountCents != null ? String(quotedAmountCents) : "",
        quotedLabel: quotedLabel || "",
        quotedCarrier: quotedCarrier || "",
        quotedService: quotedService || "",
        shippoShipmentId: shippoShipmentId || "",
        giftNote: giftNote ?? "",
        giftWrapping: giftWrapping ? "true" : "false",
        giftWrappingPriceCents: giftWrapping && giftWrappingPriceCents > 0 ? String(giftWrappingPriceCents) : "",
      },
    };

    if (destination) {
      base.payment_intent_data = {
        transfer_data: { destination },
        application_fee_amount: Math.floor(itemsSubtotalCents * 0.05), // 5% platform fee
      };
    }

    const session = await stripe.checkout.sessions.create(base);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/cart/checkout-seller error:", err);
    return NextResponse.json(
      { error: "Server error creating checkout session" },
      { status: 500 }
    );
  }
}










