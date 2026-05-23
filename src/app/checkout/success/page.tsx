// src/app/checkout/success/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import LocalDate from "@/components/LocalDate";
import { ensureUserForPage } from "@/lib/pageAuth";
import { checkoutSuccessSessionIds } from "@/lib/checkoutSuccessState";
import { publicListingPath } from "@/lib/publicPaths";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { orderItemsSubtotalCents, orderTotalCents as calculateOrderTotalCents } from "@/lib/orderTotals";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtMoney(cents: number, currency = DEFAULT_CURRENCY) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; session_ids?: string }>;
}) {
  const sp = await searchParams;
  const sessionId = sp?.session_id;
  if (!sessionId) redirect("/cart");
  const { sessionIds, truncatedCount } = checkoutSuccessSessionIds({
    sessionId,
    sessionIds: sp.session_ids,
  });

  const me = await ensureUserForPage(`/checkout/success?session_id=${encodeURIComponent(sessionId)}`);

  let s: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    s = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    redirect("/cart");
  }

  if (s.payment_status !== "paid") redirect("/cart");
  const sessionMetadata = (s.metadata ?? {}) as Record<string, string | undefined>;
  if (!sessionMetadata.buyerId || sessionMetadata.buyerId !== me.id) redirect("/cart");

  if (sessionIds.length > 1) {
    const orders = await prisma.order.findMany({
      where: { stripeSessionId: { in: sessionIds }, buyerId: me.id },
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
      orderBy: { createdAt: "desc" },
    });

    if (orders.length > 0) {
      const currencies = [...new Set(orders.map((order) => order.currency || DEFAULT_CURRENCY))];
      const currency = currencies[0] ?? DEFAULT_CURRENCY;
      const totalChargedCents = orders.reduce((sum, order) => sum + calculateOrderTotalCents(order), 0);
      const pendingCount = Math.max(0, sessionIds.length - orders.length);
      const hasMixedCurrencies = currencies.length > 1;

      return (
        <main className="mx-auto max-w-3xl p-8 space-y-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">Thanks for your purchase!</h1>
            <p className="text-neutral-600 text-sm">
              {orders.length} {orders.length === 1 ? "order has" : "orders have"} been paid.
            </p>
          </header>

          {pendingCount > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {pendingCount} {pendingCount === 1 ? "order is" : "orders are"} still being processed and will appear in your orders momentarily.
            </div>
          )}
          {truncatedCount > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {truncatedCount} additional checkout {truncatedCount === 1 ? "session was" : "sessions were"} omitted from this receipt view. Check your orders for the full list.
            </div>
          )}

          <section className="card-section">
            <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
              <div className="text-sm">
                <div className="font-medium">Receipts</div>
                <div className="text-xs text-neutral-500">
                  Buyer: {orders[0]?.buyer?.name ?? orders[0]?.buyer?.email ?? "Guest"}
                </div>
              </div>
              <div className="text-sm font-semibold">
                {hasMixedCurrencies ? `${orders.length} receipts` : fmtMoney(totalChargedCents, currency)}
              </div>
            </div>

            <div className="divide-y divide-neutral-100">
              {orders.map((order) => {
                const orderCurrency = order.currency || currency;
                const itemsSubtotalCents = orderItemsSubtotalCents(order);
                const shippingAmountCents = order.shippingAmountCents || 0;
                const taxAmountCents = order.taxAmountCents || 0;
                const giftWrappingPriceCents = order.giftWrappingPriceCents || 0;
                const orderTotalCents = calculateOrderTotalCents(order, { itemsSubtotalCents });

                return (
                  <div key={order.id}>
                    <div className="flex items-center justify-between bg-neutral-50 px-4 py-3 text-sm">
                      <div>
                        <div className="font-medium">Order #{order.id.slice(-8)}</div>
                        <div className="text-neutral-500"><LocalDate date={order.createdAt} /></div>
                      </div>
                      <div className="font-semibold">{fmtMoney(orderTotalCents, orderCurrency)}</div>
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
                              <Link href={publicListingPath(it.listingId, it.listing.title)} className="block truncate text-sm font-medium hover:underline">
                                {it.listing.title}
                              </Link>
                              <div className="text-xs text-neutral-500">Maker: {it.listing.seller.displayName}</div>
                              <div className="mt-1 text-sm text-neutral-700">{fmtMoney(it.priceCents, orderCurrency)} x {it.quantity}</div>
                            </div>
                            <div className="text-sm font-medium">{fmtMoney(it.priceCents * it.quantity, orderCurrency)}</div>
                          </li>
                        );
                      })}
                    </ul>

                    <div className="px-4 py-3 border-t border-neutral-100 space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <div className="text-neutral-600">Items subtotal</div>
                        <div className="font-medium">{fmtMoney(itemsSubtotalCents, orderCurrency)}</div>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div className="text-neutral-600">
                          Shipping{order.shippingTitle ? ` — ${order.shippingTitle}` : ""}
                        </div>
                        <div className="font-medium">{fmtMoney(shippingAmountCents, orderCurrency)}</div>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <div className="text-neutral-600">Tax</div>
                        <div className="font-medium">{fmtMoney(taxAmountCents, orderCurrency)}</div>
                      </div>
                      {giftWrappingPriceCents > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <div className="text-neutral-600">Gift wrapping</div>
                          <div className="font-medium">{fmtMoney(giftWrappingPriceCents, orderCurrency)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="flex gap-3">
            <Link href="/dashboard/orders" className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50">View my orders</Link>
            <Link href="/browse" className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50">Keep shopping</Link>
          </div>
        </main>
      );
    }
  }

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
    // The webhook is the only order writer. The success page
    // only re-queries after verifying Stripe says this paid
    // session belongs to the signed-in buyer.
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

  const currency = order.currency || DEFAULT_CURRENCY;
  const itemsSubtotalCents = orderItemsSubtotalCents(order);
  const shippingAmountCents = order.shippingAmountCents || 0;
  const taxAmountCents = order.taxAmountCents || 0;
  const giftWrappingPriceCents = order.giftWrappingPriceCents || 0;
  const totalChargedCents = calculateOrderTotalCents(order, { itemsSubtotalCents });

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
                  <Link href={publicListingPath(it.listingId, it.listing.title)} className="block truncate text-sm font-medium hover:underline">
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
          {giftWrappingPriceCents > 0 && (
            <div className="flex items-center justify-between text-sm">
              <div className="text-neutral-600">Gift wrapping</div>
              <div className="font-medium">{fmtMoney(giftWrappingPriceCents, currency)}</div>
            </div>
          )}
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
