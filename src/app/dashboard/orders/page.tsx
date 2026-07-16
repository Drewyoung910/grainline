// src/app/dashboard/orders/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import LocalDate from "@/components/LocalDate";
import { publicListingPath } from "@/lib/publicPaths";
import { blockingRefundLedgerWhere, latestRefundLedgerEvent } from "@/lib/refundRouteState";
import { orderTotalCents } from "@/lib/orderTotals";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function fmtMoney(cents: number, currency = DEFAULT_CURRENCY) {
  return formatCurrencyCents(cents, currency);
}

export default async function OrdersPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/orders");

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect("/sign-in?redirect_url=/dashboard/orders");

  const LIMIT = 20;
  const [totalOrders, orders] = await Promise.all([
    prisma.order.count({ where: { buyerId: me.id } }),
    prisma.order.findMany({
      where: { buyerId: me.id },
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
        paymentEvents: {
          where: blockingRefundLedgerWhere(),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { eventType: true, amountCents: true, status: true },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMIT,
    }),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold font-display">My orders</h1>
          <p className="text-sm text-neutral-600">
            View purchases you’ve made on Grainline.
          </p>
        </div>
        <Link
          href="/browse"
          className="inline-flex min-h-[40px] w-full shrink-0 items-center justify-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-center text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 sm:w-auto"
        >
          Continue shopping
        </Link>
      </header>

      {orders.length === 0 ? (
        <div className="card-section p-8 text-neutral-600">
          No orders yet — find something you love in the browse page.
        </div>
      ) : (
        <>
          <ul className="space-y-4">
          {orders.map((o) => {
            const currency = o.currency ?? DEFAULT_CURRENCY;
            const itemsSubtotal =
              o.itemsSubtotalCents && o.itemsSubtotalCents > 0
                ? o.itemsSubtotalCents
                : o.items.reduce((s, it) => s + it.priceCents * it.quantity, 0);
            const shipping = o.shippingAmountCents ?? 0;
            const tax = o.taxAmountCents ?? 0;
            const total = orderTotalCents(o, { itemsSubtotalCents: itemsSubtotal });
            const refundAmountCents =
              o.sellerRefundAmountCents ?? latestRefundLedgerEvent(o.paymentEvents)?.amountCents ?? null;

            return (
              <li key={o.id} className="card-section">
                <div className="flex flex-col gap-2 border-b border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <div className="font-medium">
                      <Link
                        href={`/dashboard/orders/${o.id}`}
                        className="hover:underline"
                      >
                        Order <span className="text-neutral-500">#{o.id.slice(-8)}</span>
                      </Link>
                    </div>
                    <div className="text-neutral-500">
                      <LocalDate date={o.createdAt} />
                      {o.paidAt ? " · Paid" : " · Unpaid"}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">
                    {fmtMoney(total, currency)}
                  </div>
                </div>

                <ul className="divide-y divide-neutral-100">
                  {o.items.map((it) => {
                    const img = it.listing.photos[0]?.url;
                    return (
                      <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img}
                            alt=""
                            className="h-16 w-16 shrink-0 rounded-lg border border-neutral-200 object-cover"
                          />
                        ) : (
                          <div className="h-16 w-16 shrink-0 rounded-lg border border-neutral-200 bg-neutral-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <Link
                            href={publicListingPath(it.listingId, it.listing.title)}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {it.listing.title}
                          </Link>
                          <div className="text-xs text-neutral-500">
                            Maker: {it.listing.seller.displayName}
                          </div>
                          <div className="mt-1 text-sm text-neutral-700">
                            {fmtMoney(it.priceCents, currency)} × {it.quantity}
                          </div>
                        </div>
                        <div className="text-sm font-medium">
                          {fmtMoney(it.priceCents * it.quantity, currency)}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="px-4 py-3 border-t border-neutral-100 text-sm space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-600">Items subtotal</span>
                    <span className="font-medium">{fmtMoney(itemsSubtotal, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-600">
                      Shipping{o.shippingTitle ? ` · ${o.shippingTitle}` : ""}
                    </span>
                    <span className="font-medium">{fmtMoney(shipping, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-600">Tax</span>
                    <span className="font-medium">{fmtMoney(tax, currency)}</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
                    <span className="text-neutral-800">Total</span>
                    <span className="text-base font-semibold">{fmtMoney(total, currency)}</span>
                  </div>
                  {(refundAmountCents ?? 0) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-red-600">Refund</span>
                      <span className="text-sm text-red-600">
                        -{fmtMoney(refundAmountCents!, currency)}
                      </span>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {totalOrders > LIMIT && (
          <div className="text-center pt-4">
            <Link href="/account/orders" className="text-sm text-neutral-500 hover:text-neutral-700 underline">
              View all {totalOrders} orders →
            </Link>
          </div>
        )}
        </>
      )}
    </main>
  );
}
