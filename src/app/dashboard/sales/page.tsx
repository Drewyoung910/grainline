// src/app/dashboard/sales/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { FulfillmentStatus } from "@prisma/client";
import LocalDate from "@/components/LocalDate";
import { publicListingPath } from "@/lib/publicPaths";
import { blockingRefundLedgerWhere, latestRefundLedgerEvent } from "@/lib/refundRouteState";
import { orderTotalCents } from "@/lib/orderTotals";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import { fulfillmentStatusLabel } from "@/lib/fulfillmentLabels";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { sellerFacingOrderBuyerLabel } from "@/lib/sellerFacingUser";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const PAGE_SIZE = 25;

function fmtMoney(cents: number, currency = DEFAULT_CURRENCY) {
  return formatCurrencyCents(cents, currency);
}

function StatusBadge({ status }: { status: FulfillmentStatus }) {
  const styles: Record<FulfillmentStatus, string> = {
    PENDING:          "bg-amber-100 text-amber-800",
    READY_FOR_PICKUP: "bg-blue-100 text-blue-800",
    PICKED_UP:        "bg-green-100 text-green-800",
    SHIPPED:          "bg-blue-100 text-blue-800",
    DELIVERED:        "bg-green-100 text-green-800",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {fulfillmentStatusLabel(status)}
    </span>
  );
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/sales");

  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) redirect("/sign-in?redirect_url=/dashboard/sales");

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true, displayName: true, onboardingComplete: true, chargesEnabled: true },
  });
  if (!seller) redirect("/dashboard/seller");

  if (!seller.onboardingComplete) {
    return (
      <main className="mx-auto max-w-4xl p-8 space-y-6">
        <header>
          <h1 className="font-display text-2xl font-semibold">My sales</h1>
          <p className="text-sm text-neutral-600">Orders containing your listings.</p>
        </header>
        <section className="card-section p-8">
          <p className="text-base font-semibold text-neutral-900">
            {seller.chargesEnabled ? "Finish setup to start accepting orders" : "Connect Stripe to start accepting orders"}
          </p>
          <p className="mt-2 text-sm text-neutral-600">
            Your sales dashboard will unlock after your shop setup is complete and buyers can pay you.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              href="/dashboard/onboarding"
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
            >
              Continue setup →
            </Link>
            {!seller.chargesEnabled && (
              <Link
                href="/dashboard/seller"
                className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
              >
                Connect Stripe Payouts →
              </Link>
            )}
          </div>
        </section>
      </main>
    );
  }

  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);

  const where = {
    items: {
      some: { listing: { sellerId: seller.id } },
      every: { listing: { sellerId: seller.id } },
    },
  } as const;

  const total = await prisma.order.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(requestedPage, totalPages);

  const orders = await prisma.order.findMany({
    where,
    include: {
      items: {
        include: {
          listing: {
            include: {
              photos: { orderBy: { sortOrder: "asc" }, take: 1 },
              seller: { select: { id: true } },
            },
          },
        },
      },
      buyer: { select: { id: true, deletedAt: true } },
      paymentEvents: {
        where: blockingRefundLedgerWhere(),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { eventType: true, amountCents: true, status: true },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (safePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return (
    <main className="mx-auto max-w-7xl p-8 space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">My sales</h1>
        <p className="text-sm text-neutral-600">Orders containing your listings.</p>
      </header>

      {total === 0 ? (
        <div className="card-section p-8 text-neutral-600">No orders yet — your first sale is right around the corner</div>
      ) : (
        <>
          <ul className="space-y-4">
            {orders.map((o) => {
              const myItems = o.items.filter((it) => it.listing.seller.id === seller.id);
              const mySubtotalCents = myItems.reduce(
                (s, it) => s + it.priceCents * it.quantity,
                0
              );
              const currency = o.currency ?? DEFAULT_CURRENCY;
              const shipping = o.shippingAmountCents ?? 0;
              const tax = o.taxAmountCents ?? 0;
              const giftWrapping = o.giftWrappingPriceCents ?? 0;
              // Use this seller's items subtotal (not all-seller itemsSubtotalCents)
              const orderTotal = orderTotalCents(o, { itemsSubtotalCents: mySubtotalCents });
              const status = o.fulfillmentStatus ?? "PENDING";
              const refundAmountCents =
                o.sellerRefundAmountCents ?? latestRefundLedgerEvent(o.paymentEvents)?.amountCents ?? null;

              return (
                <li key={o.id} className="card-section">
                  <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
                    <div className="text-sm">
                      <div className="flex items-center gap-2 font-medium">
                        <Link
                          href={`/dashboard/sales/${o.id}`}
                          className="hover:underline"
                        >
                          Order <span className="text-neutral-500">#{o.id.slice(-8)}</span>
                        </Link>
                        <StatusBadge status={status} />
                      </div>
                      <div className="text-neutral-500">
                        <LocalDate date={o.createdAt} />
                        {o.paidAt ? " · Paid" : " · Unpaid"}
                      </div>
                      <div className="text-xs text-neutral-500">
                        Buyer: {sellerFacingOrderBuyerLabel(o, "Deleted user")}
                      </div>
                    </div>
                    <div className="text-sm font-semibold">
                      {fmtMoney(orderTotal, currency)}
                    </div>
                  </div>

                  <ul className="divide-y divide-neutral-100">
                    {myItems.map((it) => {
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
                            <a
                              href={publicListingPath(it.listingId, it.listing.title)}
                              className="block truncate text-sm font-medium hover:underline"
                            >
                              {it.listing.title}
                            </a>
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

                  <div className="px-4 py-3 border-t border-neutral-100 text-sm space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-600">Items subtotal (your items)</span>
                      <span className="font-medium">{fmtMoney(mySubtotalCents, currency)}</span>
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
                    {giftWrapping > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-600">Gift wrapping</span>
                        <span className="font-medium">{fmtMoney(giftWrapping, currency)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100">
                      <span className="text-neutral-800">Order total</span>
                      <span className="text-base font-semibold">
                        {fmtMoney(orderTotal, currency)}
                      </span>
                    </div>
                    {(refundAmountCents ?? 0) > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-red-600">Refund issued</span>
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

          {/* Pagination */}
          <div className="flex items-center justify-between text-sm text-neutral-500">
            <span>
              {total} order{total !== 1 ? "s" : ""} · Page {safePage} of {totalPages}
            </span>
            <div className="flex gap-2">
              {safePage > 1 ? (
                <Link
                  href={`?page=${safePage - 1}`}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-300 cursor-not-allowed">
                  Previous
                </span>
              )}
              {safePage < totalPages ? (
                <Link
                  href={`?page=${safePage + 1}`}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
                >
                  Next
                </Link>
              ) : (
                <span className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-300 cursor-not-allowed">
                  Next
                </span>
              )}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
