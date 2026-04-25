// src/app/checkout/success/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import LocalDate from "@/components/LocalDate";
import { ensureUser } from "@/lib/ensureUser";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtMoney(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const sp = await searchParams;
  const sessionId = sp?.session_id;
  if (!sessionId) redirect("/cart");

  const me = await ensureUser();
  if (!me) redirect(`/sign-in?redirect_url=/checkout/success?session_id=${encodeURIComponent(sessionId)}`);

  let s: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    s = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent.charges.data", "shipping_cost.shipping_rate"],
    });
  } catch {
    redirect("/cart");
  }

  if (s.payment_status !== "paid") redirect("/cart");

  let order = await prisma.order.findFirst({
    where: { stripeSessionId: sessionId, buyerId: me.id },
    include: {
      items: {
        include: {
          listing: {
            include: {
              photos: { orderBy: { sortOrder: "asc" }, take: 1 },
              seller: { select: { displayName: true } },
            },
          },
        },
      },
      buyer: { select: { id: true, name: true, email: true, imageUrl: true } },
    },
  });

  if (!order) {
    const meta = (s.metadata ?? {}) as Record<string, string | undefined>;
    const isEmbeddedCheckout = meta.taxRetainedAtCreation === "true";
    const buyerId = meta.buyerId;
    if (!buyerId) redirect("/cart");
    if (buyerId !== me.id) redirect("/cart");

    // Stripe snapshots
    const currency: string = (s.currency || "usd").toLowerCase();
    const itemsSubtotalCents: number = s.amount_subtotal ?? 0;
    const shippingAmountCents: number = s.shipping_cost?.amount_subtotal ?? 0;
    const shippingTitle: string | undefined =
      (s.shipping_cost?.shipping_rate as { display_name?: string })?.display_name || undefined;
    const taxAmountCents: number = s.total_details?.amount_tax ?? 0;

    const buyerEmail: string | undefined = s.customer_details?.email || undefined;
    const buyerName: string | undefined = s.customer_details?.name || undefined;

    const addr = {
      line1: meta.quotedToLine1 ?? (s as { shipping_details?: { address?: Record<string, string | null> } }).shipping_details?.address?.line1 ?? null,
      line2: meta.quotedToLine2 ?? (s as { shipping_details?: { address?: Record<string, string | null> } }).shipping_details?.address?.line2 ?? null,
      city: meta.quotedToCity ?? (s as { shipping_details?: { address?: Record<string, string | null> } }).shipping_details?.address?.city ?? null,
      state: meta.quotedToState ?? (s as { shipping_details?: { address?: Record<string, string | null> } }).shipping_details?.address?.state ?? null,
      postal_code: meta.quotedToPostalCode ?? (s as { shipping_details?: { address?: Record<string, string | null> } }).shipping_details?.address?.postal_code ?? null,
      country: meta.quotedToCountry ?? (s as { shipping_details?: { address?: Record<string, string | null> } }).shipping_details?.address?.country ?? null,
    };
    const shipToLine1 = addr.line1;
    const shipToLine2 = addr.line2;
    const shipToCity = addr.city;
    const shipToState = addr.state;
    const shipToPostalCode = addr.postal_code;
    const shipToCountry = addr.country;

    const pi = typeof s.payment_intent === "string" ? null : (s.payment_intent as { id?: string; charges?: { data?: { id?: string; application_fee?: string | { id?: string }; transfer?: string | { id?: string } }[] } });
    const paymentIntentId =
      typeof s.payment_intent === "string" ? s.payment_intent : pi?.id ?? null;
    const charge = pi?.charges?.data?.[0] ?? null;
    const stripeChargeId = charge?.id ?? null;
    const stripeApplicationFeeId =
      (typeof charge?.application_fee === "string"
        ? charge.application_fee
        : charge?.application_fee?.id) ?? null;
    const stripeTransferId =
      (typeof charge?.transfer === "string"
        ? charge.transfer
        : charge?.transfer?.id) ?? null;

    const cartId = meta.cartId;
    const sellerIdFromMeta = meta.sellerId;

    if (!isEmbeddedCheckout) {
      // Hosted checkout: webhook may not have fired yet.
      // Fallback order creation with P2002 safety catch.
      if (cartId) {
        try {
          order = await prisma.$transaction(async (tx) => {
            const cart = await tx.cart.findUnique({
              where: { id: cartId },
              include: {
                items: {
                  include: { listing: true },
                  where: sellerIdFromMeta ? { listing: { sellerId: sellerIdFromMeta } } : undefined,
                },
              },
            });

            if (!cart || cart.items.length === 0) return null;

            const created = await tx.order.create({
              data: {
                buyerId,
                paidAt: new Date(),
                stripeSessionId: sessionId,

                currency,
                itemsSubtotalCents,
                shippingTitle,
                shippingAmountCents,
                taxAmountCents,

                buyerEmail,
                buyerName,
                shipToLine1,
                shipToLine2,
                shipToCity,
                shipToState,
                shipToPostalCode,
                shipToCountry,

                quotedToName: meta.quotedToName ?? null,
                quotedToPhone: meta.quotedToPhone ?? null,

                stripePaymentIntentId: paymentIntentId,
                stripeChargeId,
                stripeApplicationFeeId,
                stripeTransferId,
              },
            });

            for (const it of cart.items) {
              await tx.orderItem.create({
                data: {
                  orderId: created.id,
                  listingId: it.listingId,
                  quantity: it.quantity,
                  priceCents: it.priceCents,
                },
              });
            }

            await tx.cartItem.deleteMany({
              where: sellerIdFromMeta ? { cartId, listing: { sellerId: sellerIdFromMeta } } : { cartId },
            });

            return tx.order.findUnique({
              where: { id: created.id },
              include: {
                items: {
                  include: {
                    listing: {
                      include: {
                        photos: { orderBy: { sortOrder: "asc" }, take: 1 },
                        seller: { select: { displayName: true } },
                      },
                    },
                  },
                },
                buyer: { select: { id: true, name: true, email: true, imageUrl: true } },
              },
            });
          });

          if (!order) redirect("/dashboard/orders");
        } catch (e: unknown) {
          if (
            e && typeof e === "object" && "code" in e &&
            (e as { code: string }).code === "P2002"
          ) {
            // Webhook created the order between our check and create
            // Re-query it
            order = await prisma.order.findFirst({
              where: { stripeSessionId: sessionId, buyerId: me.id },
              include: {
                items: {
                  include: {
                    listing: {
                      include: {
                        photos: { orderBy: { sortOrder: "asc" }, take: 1 },
                        seller: { select: { displayName: true } },
                      },
                    },
                  },
                },
                buyer: { select: { id: true, name: true, email: true, imageUrl: true } },
              },
            });
            if (!order) redirect("/dashboard/orders");
          } else {
            throw e;
          }
        }
      } else if (meta.listingId) {
        const listingId = meta.listingId;
        const quantity = Math.max(1, Number(meta.quantity || 1));
        const priceCentsFromMeta = meta.priceCents ? Number(meta.priceCents) : null;

        const price =
          priceCentsFromMeta ??
          (await prisma.listing.findUnique({
            where: { id: listingId },
            select: { priceCents: true },
          }))?.priceCents ??
          0;

        try {
          order = await prisma.order.create({
            data: {
              buyerId,
              paidAt: new Date(),
              stripeSessionId: sessionId,

              currency,
              itemsSubtotalCents,
              shippingTitle,
              shippingAmountCents,
              taxAmountCents,

              buyerEmail,
              buyerName,
              shipToLine1,
              shipToLine2,
              shipToCity,
              shipToState,
              shipToPostalCode,
              shipToCountry,

              quotedToName: meta.quotedToName ?? null,
              quotedToPhone: meta.quotedToPhone ?? null,

              stripePaymentIntentId: paymentIntentId,
              stripeChargeId,
              stripeApplicationFeeId,
              stripeTransferId,

              items: { create: [{ listingId, quantity, priceCents: price }] },
            },
            include: {
              items: {
                include: {
                  listing: {
                    include: {
                      photos: { orderBy: { sortOrder: "asc" }, take: 1 },
                      seller: { select: { displayName: true } },
                    },
                  },
                },
              },
              buyer: { select: { id: true, name: true, email: true, imageUrl: true } },
            },
          });
        } catch (e: unknown) {
          if (
            e && typeof e === "object" && "code" in e &&
            (e as { code: string }).code === "P2002"
          ) {
            // Webhook created the order between our check and create
            // Re-query it
            order = await prisma.order.findFirst({
              where: { stripeSessionId: sessionId, buyerId: me.id },
              include: {
                items: {
                  include: {
                    listing: {
                      include: {
                        photos: { orderBy: { sortOrder: "asc" }, take: 1 },
                        seller: { select: { displayName: true } },
                      },
                    },
                  },
                },
                buyer: { select: { id: true, name: true, email: true, imageUrl: true } },
              },
            });
            if (!order) redirect("/dashboard/orders");
          } else {
            throw e;
          }
        }
      } else {
        redirect("/dashboard/orders");
      }
    } else {
      // Embedded checkout: webhook creates the order.
      // Single re-query — webhook is often fast enough
      // that it fires during page load.
      // Do NOT call order.create (webhook owns this).
      order = await prisma.order.findFirst({
        where: { stripeSessionId: sessionId, buyerId: me.id },
        include: {
          items: {
            include: {
              listing: {
                include: {
                  photos: { orderBy: { sortOrder: "asc" }, take: 1 },
                  seller: { select: { displayName: true } },
                },
              },
            },
          },
          buyer: { select: { id: true, name: true, email: true, imageUrl: true } },
        },
      });
    }
  }

  if (!order) {
    return (
      <main className="mx-auto max-w-3xl p-8 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">
            Payment successful!
          </h1>
          <p className="text-neutral-600 text-sm">
            Your order is being processed and will appear
            in your orders momentarily.
          </p>
        </header>
        <div className="flex gap-3">
          <Link
            href="/dashboard/orders"
            className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            View my orders
          </Link>
          <Link
            href="/browse"
            className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
          >
            Keep shopping
          </Link>
        </div>
      </main>
    );
  }

  const currency = order.currency || "usd";
  const itemsSubtotalCents =
    order.itemsSubtotalCents || order.items.reduce((s, it) => s + it.priceCents * it.quantity, 0);
  const shippingAmountCents = order.shippingAmountCents || 0;
  const taxAmountCents = order.taxAmountCents || 0;
  const totalChargedCents = itemsSubtotalCents + shippingAmountCents + taxAmountCents;

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Thanks for your purchase!</h1>
        <p className="text-neutral-600 text-sm">
          Order <span className="font-mono">#{order.id.slice(-8)}</span>{" "}
          {order.paidAt ? "has been paid." : "is pending."}
        </p>
      </header>

      <section className="card-section">
        <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
          <div className="text-sm">
            <div className="font-medium">Receipt</div>
            <div className="text-neutral-500"><LocalDate date={order.createdAt} /></div>
            <div className="text-xs text-neutral-500">Buyer: {order.buyer?.name ?? order.buyer?.email ?? "Guest"}</div>
          </div>
          <div className="text-sm font-semibold">{fmtMoney(totalChargedCents, currency)}</div>
        </div>

        <ul className="divide-y divide-neutral-100">
          {order.items.map((it) => {
            const img = it.listing.photos[0]?.url;
            return (
              <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" className="h-16 w-16 rounded border object-cover" />
                ) : (
                  <div className="h-16 w-16 rounded border bg-neutral-100" />
                )}
                <div className="min-w-0 flex-1">
                  <Link href={`/listing/${it.listingId}`} className="block truncate text-sm font-medium hover:underline">
                    {it.listing.title}
                  </Link>
                  <div className="text-xs text-neutral-500">Maker: {it.listing.seller.displayName}</div>
                  <div className="mt-1 text-sm text-neutral-700">{fmtMoney(it.priceCents, currency)} × {it.quantity}</div>
                </div>
                <div className="text-sm font-medium">{fmtMoney(it.priceCents * it.quantity, currency)}</div>
              </li>
            );
          })}
        </ul>

        <div className="px-4 py-3 border-t border-neutral-100 space-y-1">
          <div className="flex items-center justify-between text-sm">
            <div className="text-neutral-600">Items subtotal</div>
            <div className="font-medium">{fmtMoney(itemsSubtotalCents, currency)}</div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="text-neutral-600">
              Shipping{order.shippingTitle ? ` — ${order.shippingTitle}` : ""}
            </div>
            <div className="font-medium">{fmtMoney(shippingAmountCents, currency)}</div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <div className="text-neutral-600">Tax</div>
            <div className="font-medium">{fmtMoney(taxAmountCents, currency)}</div>
          </div>
          <hr className="my-1" />
          <div className="flex items-center justify-between text-base">
            <div className="text-neutral-800">Total charged</div>
            <div className="font-semibold">{fmtMoney(totalChargedCents, currency)}</div>
          </div>
        </div>
      </section>

      <div className="flex gap-3">
        <Link href="/dashboard/orders" className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50">View my orders</Link>
        <Link href="/browse" className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50">Keep shopping</Link>
      </div>
    </main>
  );
}

