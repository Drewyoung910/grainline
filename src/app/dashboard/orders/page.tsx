// src/app/dashboard/orders/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { userIdByClerkId } from "@/lib/userIdentityAccess";
import LocalDate from "@/components/LocalDate";
import { publicListingPath } from "@/lib/publicPaths";
import { buyerRefundOutcomes } from "@/lib/orderPaymentEventReadAuthority";
import { orderTotalCents } from "@/lib/orderTotals";
import {
  orderPaymentPresentationLabel,
  orderPaymentPresentationState,
  suppressActiveFulfillmentForPaymentState,
} from "@/lib/orderPaymentPresentation";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import { BuyerOrdersSkeleton } from "@/components/SellerRouteSkeletons";
import { Suspense } from "react";
import type { Metadata } from "next";
import {
  countBuyerOrders,
  readBuyerOrderSummaryPage,
} from "@/lib/orderParticipantReadAuthority";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function fmtMoney(cents: number, currency = DEFAULT_CURRENCY) {
  return formatCurrencyCents(cents, currency);
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<BuyerOrdersSkeleton />}>
      <OrdersContent />
    </Suspense>
  );
}

async function OrdersContent() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/orders");

  const me = await userIdByClerkId(prisma, userId);
  if (!me) redirect("/sign-in?redirect_url=/dashboard/orders");

  const LIMIT = 20;
  const [totalOrders, orderPage] = await Promise.all([
    countBuyerOrders(me.id),
    readBuyerOrderSummaryPage({ actorUserId: me.id, limit: LIMIT }),
  ]);
  const orders = orderPage.rows;
  const refundOutcomes = await buyerRefundOutcomes(
    me.id,
    orders.map((order) => order.id),
  );

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display page-title">My orders</h1>
          <p className="text-sm text-neutral-600">
            View purchases you’ve made on Grainline.
          </p>
        </div>
        <Link
          href="/browse"
          className="btn btn-secondary btn-sm w-full shrink-0 justify-center text-center sm:w-auto"
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
            const total = orderTotalCents(o, { itemsSubtotalCents: itemsSubtotal });
            const refundOutcome = refundOutcomes.get(o.id) ?? null;
            const refundAmountCents =
              o.sellerRefundAmountCents ?? refundOutcome?.amountCents ?? null;
            const paymentState = orderPaymentPresentationState({
              paid: o.paidAt != null,
              orderTotalCents: total,
              refundAmountCents,
              // The bounded summary exposes an amount only after local record
              // finalization; pending provider state comes from refundOutcome.
              refundRecorded: o.sellerRefundAmountCents != null,
              providerRefundStatus: refundOutcome?.status ?? null,
            });
            const paymentLabel = orderPaymentPresentationLabel(paymentState);
            const suppressActiveFulfillment = suppressActiveFulfillmentForPaymentState(
              paymentState,
              o.fulfillmentStatus,
            );

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
                      {` · ${paymentLabel}`}
                      {suppressActiveFulfillment ? " · Fulfillment closed" : ""}
                    </div>
                  </div>
                  <div className="text-sm font-semibold">
                    {fmtMoney(total, currency)}
                  </div>
                </div>

                <ul className="divide-y divide-neutral-100">
                  {o.items.map((it) => {
                    const img = it.imageUrl;
                    return (
                      <li key={it.id} className="flex items-center gap-3 px-4 py-3">
                        {img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img}
                            alt=""
                            className="h-16 w-16 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="h-16 w-16 shrink-0 rounded-lg bg-neutral-100" />
                        )}
                        <div className="min-w-0 flex-1">
                          <Link
                            href={publicListingPath(it.listingId, it.title)}
                            className="block truncate text-sm font-medium hover:underline"
                          >
                            {it.title}
                          </Link>
                          <div className="text-xs text-neutral-500">
                            Maker: {it.sellerName}
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
                  {o.itemCount > o.items.length && (
                    <li className="px-4 py-3 text-sm text-neutral-500">
                      +{o.itemCount - o.items.length} more item{o.itemCount - o.items.length === 1 ? "" : "s"}
                    </li>
                  )}
                </ul>

                {(refundAmountCents ?? 0) > 0 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100 text-sm">
                    <span className="text-red-600">Refund</span>
                    <span className="text-red-600">
                      -{fmtMoney(refundAmountCents!, currency)}
                    </span>
                  </div>
                )}
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
