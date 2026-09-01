// src/app/dashboard/sales/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { FulfillmentStatus } from "@prisma/client";
import LocalDate from "@/components/LocalDate";
import { publicListingPath } from "@/lib/publicPaths";
import { sellerRefundOutcomes } from "@/lib/orderPaymentEventReadAuthority";
import { orderTotalCents } from "@/lib/orderTotals";
import {
  orderPaymentPresentationLabel,
  orderPaymentPresentationState,
  suppressActiveFulfillmentForPaymentState,
} from "@/lib/orderPaymentPresentation";
import { DEFAULT_CURRENCY, formatCurrencyCents } from "@/lib/money";
import { fulfillmentStatusLabel } from "@/lib/fulfillmentLabels";
import { sellerFacingOrderBuyerLabel } from "@/lib/sellerFacingUser";
import type { Metadata } from "next";
import { Suspense } from "react";
import { SalesListSkeleton } from "@/components/CommerceRouteSkeletons";
import {
  countSellerOrders,
  readSellerOrderSummaryPage,
} from "@/lib/orderParticipantReadAuthority";
import {
  buildOrderHistoryCursor,
  orderListCursorFromRow,
  parseOrderHistoryCursor,
} from "@/lib/orderHistoryCursor";

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

function RefundedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      Fully refunded
    </span>
  );
}

export default function SalesPage(props: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<SalesListSkeleton />}>
      <SalesContent {...props} />
    </Suspense>
  );
}

async function SalesContent({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
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

  const { cursor: rawCursor } = await searchParams;
  const historyCursor = parseOrderHistoryCursor(rawCursor);
  const page = historyCursor?.page ?? 1;
  const [total, orderPage] = await Promise.all([
    countSellerOrders(me.id),
    readSellerOrderSummaryPage({
      actorUserId: me.id,
      limit: PAGE_SIZE,
      cursor: historyCursor?.boundary ?? null,
      direction: historyCursor?.direction ?? "older",
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const orders = orderPage.rows;
  if (historyCursor && (page > totalPages || (total > 0 && orders.length === 0))) {
    redirect("/dashboard/sales");
  }
  const refundOutcomes = await sellerRefundOutcomes(
    me.id,
    orders.map((order) => order.id),
  );
  const firstOrder = orders[0];
  const lastOrder = orders.at(-1);
  const previousHref = page <= 1 || !firstOrder
    ? null
    : page === 2
      ? "/dashboard/sales"
      : `/dashboard/sales?cursor=${encodeURIComponent(buildOrderHistoryCursor({
          direction: "newer",
          page: page - 1,
          boundary: orderListCursorFromRow(firstOrder),
        }))}`;
  const nextHref = page >= totalPages || !lastOrder
    ? null
    : `/dashboard/sales?cursor=${encodeURIComponent(buildOrderHistoryCursor({
        direction: "older",
        page: page + 1,
        boundary: orderListCursorFromRow(lastOrder),
      }))}`;

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
              const myItems = o.items;
              const mySubtotalCents = o.itemsSubtotalCents;
              const currency = o.currency ?? DEFAULT_CURRENCY;
              const shipping = o.shippingAmountCents ?? 0;
              const tax = o.taxAmountCents ?? 0;
              const giftWrapping = o.giftWrappingPriceCents ?? 0;
              // Orders are durably single-seller; use the complete checkout subtotal,
              // not the five item summaries rendered on this list card.
              const orderTotal = orderTotalCents(o, { itemsSubtotalCents: mySubtotalCents });
              const status = o.fulfillmentStatus ?? "PENDING";
              const refundOutcome = refundOutcomes.get(o.id) ?? null;
              const refundAmountCents =
                o.sellerRefundAmountCents ?? refundOutcome?.amountCents ?? null;
              const paymentState = orderPaymentPresentationState({
                paid: o.paidAt != null,
                orderTotalCents: orderTotal,
                refundAmountCents,
                refundRecorded: o.sellerRefundState === "RECORDED",
                providerRefundStatus: refundOutcome?.status ?? null,
              });
              const suppressActiveFulfillment = suppressActiveFulfillmentForPaymentState(
                paymentState,
                status,
              );

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
                        {suppressActiveFulfillment ? <RefundedBadge /> : <StatusBadge status={status} />}
                        {o.sellerNotesPresent && (
                          <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Notes
                          </span>
                        )}
                      </div>
                      <div className="text-neutral-500">
                        <LocalDate date={o.createdAt} />
                        {` · ${orderPaymentPresentationLabel(paymentState)}`}
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
                      const img = it.imageUrl;
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
                              href={publicListingPath(it.listingId, it.title)}
                              className="block truncate text-sm font-medium hover:underline"
                            >
                              {it.title}
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
                    {o.itemCount > o.items.length && (
                      <li className="px-4 py-3 text-sm text-neutral-500">
                        +{o.itemCount - o.items.length} more item{o.itemCount - o.items.length === 1 ? "" : "s"}
                      </li>
                    )}
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
              {total} order{total !== 1 ? "s" : ""} · Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              {previousHref ? (
                <Link
                  href={previousHref}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
                >
                  Previous
                </Link>
              ) : (
                <span className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-300 cursor-not-allowed">
                  Previous
                </span>
              )}
              {nextHref ? (
                <Link
                  href={nextHref}
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
