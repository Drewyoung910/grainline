// src/app/account/orders/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ensureUserForPage } from "@/lib/pageAuth";
import LocalDate from "@/components/LocalDate";
import { publicListingPath } from "@/lib/publicPaths";
import { buyerRefundOutcomes } from "@/lib/orderPaymentEventReadAuthority";
import { orderTotalCents } from "@/lib/orderTotals";
import {
  orderPaymentPresentationLabel,
  orderPaymentPresentationState,
  suppressActiveFulfillmentForPaymentState,
} from "@/lib/orderPaymentPresentation";
import { formatCurrencyCents } from "@/lib/money";
import {
  countBuyerOrders,
  readBuyerOrderSummaryPage,
} from "@/lib/orderParticipantReadAuthority";
import {
  buildOrderHistoryCursor,
  orderListCursorFromRow,
  parseOrderHistoryCursor,
} from "@/lib/orderHistoryCursor";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Orders",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const me = await ensureUserForPage("/account/orders");

  const { cursor: rawCursor } = await searchParams;
  const historyCursor = parseOrderHistoryCursor(rawCursor);
  const page = historyCursor?.page ?? 1;
  const [totalOrders, orderPage] = await Promise.all([
    countBuyerOrders(me.id),
    readBuyerOrderSummaryPage({
      actorUserId: me.id,
      limit: PAGE_SIZE,
      cursor: historyCursor?.boundary ?? null,
      direction: historyCursor?.direction ?? "older",
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(totalOrders / PAGE_SIZE));
  const orders = orderPage.rows;
  if (historyCursor && (page > totalPages || (totalOrders > 0 && orders.length === 0))) {
    redirect("/account/orders");
  }
  const refundOutcomes = await buyerRefundOutcomes(
    me.id,
    orders.map((order) => order.id),
  );
  const firstOrder = orders[0];
  const lastOrder = orders.at(-1);
  const previousHref = page <= 1 || !firstOrder
    ? null
    : page === 2
      ? "/account/orders"
      : `/account/orders?cursor=${encodeURIComponent(buildOrderHistoryCursor({
          direction: "newer",
          page: page - 1,
          boundary: orderListCursorFromRow(firstOrder),
        }))}`;
  const nextHref = page >= totalPages || !lastOrder
    ? null
    : `/account/orders?cursor=${encodeURIComponent(buildOrderHistoryCursor({
        direction: "older",
        page: page + 1,
        boundary: orderListCursorFromRow(lastOrder),
      }))}`;

  function formatStatus(status: string | null) {
    if (!status) return "Processing";
    switch (status) {
      case "PENDING": return "Processing";
      case "READY_FOR_PICKUP": return "Ready for Pickup";
      case "PICKED_UP": return "Picked Up";
      case "SHIPPED": return "Shipped";
      case "DELIVERED": return "Delivered";
      default: return status;
    }
  }

  function statusColor(status: string | null) {
    switch (status) {
      case "DELIVERED":
      case "PICKED_UP":
        return "bg-green-100 text-green-800";
      case "SHIPPED":
        return "bg-blue-100 text-blue-800";
      case "READY_FOR_PICKUP":
        return "bg-amber-100 text-amber-800";
      default:
        return "bg-neutral-100 text-neutral-700";
    }
  }

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/account" className="text-sm text-neutral-500 hover:text-neutral-700">
          ← My Account
        </Link>
        <h1 className="text-3xl font-bold font-display">My Orders</h1>
      </div>

      {orders.length === 0 ? (
        <div className="card-section p-8 text-center space-y-3">
          <p className="text-neutral-600">No orders yet.</p>
          <Link
            href="/browse"
            className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Browse pieces →
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => {
            const total = orderTotalCents(order);
            const refundOutcome = refundOutcomes.get(order.id) ?? null;
            const refundAmountCents =
              order.sellerRefundAmountCents ?? refundOutcome?.amountCents ?? null;
            const paymentState = orderPaymentPresentationState({
              paid: order.paidAt != null,
              orderTotalCents: total,
              refundAmountCents,
              // The bounded summary exposes an amount only after local record
              // finalization; pending provider state comes from refundOutcome.
              refundRecorded: order.sellerRefundAmountCents != null,
              providerRefundStatus: refundOutcome?.status ?? null,
            });
            const suppressActiveFulfillment = suppressActiveFulfillmentForPaymentState(
              paymentState,
              order.fulfillmentStatus,
            );

            return (
              <li key={order.id} className="card-section overflow-hidden">
                {/* Order header */}
                <div className="flex flex-col gap-2 border-b border-neutral-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <span className="text-neutral-500 text-xs">Order</span>{" "}
                    <span className="font-mono text-xs text-neutral-700">{order.id.slice(-8).toUpperCase()}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-neutral-500">
                      <LocalDate date={order.createdAt} />
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      suppressActiveFulfillment
                        ? "bg-green-100 text-green-800"
                        : statusColor(order.fulfillmentStatus)
                    }`}>
                      {suppressActiveFulfillment
                        ? orderPaymentPresentationLabel(paymentState)
                        : formatStatus(order.fulfillmentStatus)}
                    </span>
                  </div>
                </div>

                {/* Items */}
                <ul className="divide-y divide-neutral-100">
                  {order.items.map((item) => {
                    const thumb = item.imageUrl;
                    return (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-neutral-200 object-cover" />
                        ) : (
                          <div className="h-12 w-12 shrink-0 rounded-lg border border-neutral-200 bg-neutral-100" />
                        )}
                        <div className="flex-1 min-w-0">
                          <Link
                            href={publicListingPath(item.listingId, item.title)}
                            className="text-sm font-medium hover:underline truncate block"
                          >
                            {item.title}
                          </Link>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            Qty {item.quantity} ·{" "}
                            {formatCurrencyCents(item.priceCents, order.currency)} each
                          </p>
                        </div>
                      </li>
                    );
                  })}
                  {order.itemCount > order.items.length && (
                    <li className="px-4 py-3 text-sm text-neutral-500">
                      +{order.itemCount - order.items.length} more item{order.itemCount - order.items.length === 1 ? "" : "s"}
                    </li>
                  )}
                </ul>

                {/* Order footer */}
                <div className="flex flex-col gap-3 border-t border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <span className="text-neutral-500">Total: </span>
                    <span className="font-semibold">
                      {formatCurrencyCents(total, order.currency)}
                    </span>
                    {(refundAmountCents ?? 0) > 0 && (
                      <span className="text-sm text-red-600 ml-2">
                        (Refund: -{formatCurrencyCents(refundAmountCents!, order.currency)})
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {order.labelTrackingNumber && (
                      <span className="text-xs text-neutral-500">
                        {order.labelCarrier} · {order.labelTrackingNumber}
                      </span>
                    )}
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="inline-flex min-h-[34px] items-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                    >
                      View details
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          {previousHref && (
            <Link
              href={previousHref}
              className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              ← Previous
            </Link>
          )}
          <span className="text-sm text-neutral-600">
            Page {page} of {totalPages}
          </span>
          {nextHref && (
            <Link
              href={nextHref}
              className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
