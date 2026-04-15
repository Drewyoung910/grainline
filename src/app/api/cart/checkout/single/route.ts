import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { shippoRatesMultiPiece } from "@/lib/shippo";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { checkoutRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { z } from "zod";

const CheckoutSingleSchema = z.object({
  listingId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).optional(),
  giftNote: z.string().max(200).optional().nullable(),
  giftWrapping: z.boolean().optional(),
  giftWrappingPriceCents: z.number().int().min(0).max(10000000).optional().nullable(),
  toPostal: z.string().max(20).optional().nullable(),
  toState: z.string().max(50).optional().nullable(),
  toCity: z.string().max(100).optional().nullable(),
  toCountry: z.string().max(2).optional().nullable(),
});

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
    if (b.__boost !== a.__boost) return b.__boost - a.__boost;
    if (a.amountCents !== b.amountCents) return a.amountCents - b.amountCents;
    const ad = a.estDays ?? 999, bd = b.estDays ?? 999;
    return ad - bd;
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

    const { success, reset } = await safeRateLimit(checkoutRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many checkout attempts.");

    const me = await ensureUserByClerkId(userId);

    let singleParsed;
    try {
      singleParsed = CheckoutSingleSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { listingId } = singleParsed;
    const quantity = Math.max(1, Math.min(99, singleParsed.quantity ?? 1));

    const giftNote: string = singleParsed.giftNote?.slice(0, 200) ?? "";
    const giftWrapping: boolean = singleParsed.giftWrapping === true;
    const giftWrappingPriceCents: number =
      singleParsed.giftWrappingPriceCents && singleParsed.giftWrappingPriceCents > 0
        ? Math.round(singleParsed.giftWrappingPriceCents)
        : 0;

    const toPostal  = singleParsed.toPostal  ?? undefined;
    const toState   = singleParsed.toState   ?? undefined;
    const toCity    = singleParsed.toCity    ?? undefined;
    const toCountry = singleParsed.toCountry ?? "US";

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        photos: true,
        seller: {
          select: {
            userId: true,
            stripeAccountId: true,
            chargesEnabled: true,
            vacationMode: true,
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
        },
      },
    });
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    if (listing.seller.userId === me.id) {
      return NextResponse.json({ error: "You cannot buy your own listing." }, { status: 400 });
    }

    if (listing.seller.vacationMode) {
      return NextResponse.json(
        { error: "This seller is currently on vacation and not accepting new orders." },
        { status: 400 }
      );
    }

    const currency = (listing.currency || "usd").toLowerCase();
    const destination = listing.seller.stripeAccountId || null;
    const sp = listing.seller;

    // Pre-flight: verify seller can accept payments
    if (!destination || !sp.chargesEnabled) {
      return NextResponse.json({ error: "This seller is not currently accepting orders. Please try again later." }, { status: 400 });
    }

    // Build shipping options — attempt live Shippo rates first
    const shipping_options: Record<string, unknown>[] = [];
    let quotedAmountCents: number | undefined;
    let shippoShipmentId: string | undefined;

    if (sp.shipFromLine1 && sp.shipFromCity && sp.shipFromState && sp.shipFromPostal) {
      try {
        // Cast both to number to handle Int? vs Float? inconsistency across listing and seller defaults
        const totalWeightGrams = Number(listing.packagedWeightGrams ?? sp.defaultPkgWeightGrams ?? 0) * quantity;
        const lengthCm = Number(listing.packagedLengthCm ?? sp.defaultPkgLengthCm ?? 0);
        const widthCm  = Number(listing.packagedWidthCm  ?? sp.defaultPkgWidthCm  ?? 0);
        const heightCm = Number(listing.packagedHeightCm ?? sp.defaultPkgHeightCm ?? 0);

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
          const liveRates: LiveRate[] = (rawRates as RawRate[])
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

          const best = prioritizeAndTrim(liveRates, 4);
          best.forEach((r, idx) => {
            if (idx === 0) quotedAmountCents = r.amountCents;
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
        }
      } catch (e) {
        console.warn("Shippo quote failed for single checkout; using fallback", e);
      }
    }

    // Fallback: read SiteConfig for a platform-level flat rate
    if (shipping_options.length === 0) {
      const siteConfig = await prisma.siteConfig.findUnique({ where: { id: 1 } });
      const fallbackCents = siteConfig?.fallbackShippingCents ?? 1500;
      quotedAmountCents = fallbackCents;
      shipping_options.push({
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: fallbackCents, currency },
          display_name: "Standard Shipping",
          tax_behavior: "exclusive",
        },
      });
    }

    const line_items: {
      quantity: number;
      price_data: { currency: string; unit_amount: number; product_data: { name: string; images?: string[]; metadata?: Record<string, string> } };
    }[] = [
      {
        quantity,
        price_data: {
          currency,
          unit_amount: listing.priceCents,
          product_data: {
            name: listing.title,
            images: listing.photos.length ? [listing.photos[0].url] : undefined,
            metadata: { listingId: listing.id },
          },
        },
      },
    ];

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

    const application_fee_amount = Math.floor(listing.priceCents * quantity * 0.05); // 5% platform fee

    const success_url = `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url  = `${process.env.NEXT_PUBLIC_APP_URL}/listing/${listing.id}`;

    const base: Record<string, unknown> = {
      mode: "payment",
      success_url,
      cancel_url,
      line_items,
      billing_address_collection: "auto",
      shipping_address_collection: { allowed_countries: ["US"] },
      automatic_tax: { enabled: true, liability: { type: "self" } },
      shipping_options,
      metadata: {
        listingId: listing.id,
        buyerId: me.id,
        quantity,
        priceCents: listing.priceCents,
        // Quoted address snapshot for webhook mismatch detection
        quotedShipToPostalCode: toPostal || "",
        quotedShipToState: toState || "",
        quotedShipToCity: toCity || "",
        quotedShipToCountry: toCountry || "US",
        quotedShippingAmountCents: quotedAmountCents != null ? String(quotedAmountCents) : "",
        shippoShipmentId: shippoShipmentId || "",
        giftNote: giftNote ?? "",
        giftWrapping: giftWrapping ? "true" : "false",
        giftWrappingPriceCents: giftWrapping && giftWrappingPriceCents > 0 ? String(giftWrappingPriceCents) : "",
      },
    };

    base.payment_intent_data = {
      on_behalf_of: destination,
      transfer_data: { destination },
      application_fee_amount,
    };

    const session = await stripe.checkout.sessions.create(base);
    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    console.error("POST /api/checkout/single error:", err);
    const msg = err instanceof Error ? err.message : "Server error creating checkout session";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
