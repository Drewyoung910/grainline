import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { shippoRatesMultiPiece } from "@/lib/shippo";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { checkoutRatelimit, rateLimitResponse } from "@/lib/ratelimit";

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

    const { success, reset } = await checkoutRatelimit.limit(userId);
    if (!success) return rateLimitResponse(reset, "Too many checkout attempts.");

    const me = await ensureUserByClerkId(userId);

    const body = await req.json();
    const { listingId, quantity: qtyRaw } = body;
    if (!listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });
    const quantity = Math.max(1, Math.min(99, Number(qtyRaw || 1)));

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

    const listing = await prisma.listing.findUnique({
      where: { id: String(listingId) },
      include: {
        photos: true,
        seller: {
          select: {
            userId: true,
            stripeAccountId: true,
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
      automatic_tax: { enabled: true },
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

    if (destination) {
      base.payment_intent_data = {
        transfer_data: { destination },
        application_fee_amount,
      };
    }

    const session = await stripe.checkout.sessions.create(base);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/checkout/single error:", err);
    return NextResponse.json({ error: "Server error creating checkout session" }, { status: 500 });
  }
}
