// src/app/account/orders/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ensureUserForPage } from "@/lib/pageAuth";
import LocalDate from "@/components/LocalDate";
import { publicListingPath } from "@/lib/publicPaths";
import { latestRefundLedgerEvent } from "@/lib/refundRouteState";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Orders",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const me = await ensureUserForPage("/account/orders");

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);

  const [totalOrders, orders] = await Promise.all([
    prisma.order.count({ where: { buyerId: me.id } }),
    prisma.order.findMany({
      where: { buyerId: me.id },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        currency: true,
        itemsSubtotalCents: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        sellerRefundAmountCents: true,
        fulfillmentStatus: true,
        labelTrackingNumber: true,
        labelCarrier: true,
        paymentEvents: {
          where: { eventType: "REFUND" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { eventType: true, amountCents: true },
        },
        items: {
          select: {
            id: true,
            priceCents: true,
            quantity: true,
            listing: {
              select: {
                id: true,
                title: true,
                photos: {
                  take: 1,
                  orderBy: { sortOrder: "asc" },
                  select: { url: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const totalPages = Math.ceil(totalOrders / PAGE_SIZE);

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
        <h1 className="text-3xl font-bold">My Orders</h1>
      </div>

      {orders.length === 0 ? (
        <div className="border border-neutral-200 p-8 text-center space-y-3">
          <p className="text-neutral-600">No orders yet.</p>
          <Link
            href="/browse"
            className="inline-block border border-neutral-900 bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800 transition-colors"
          >
            Browse pieces →
          </Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => {
            const computedTotal =
              (order.itemsSubtotalCents || 0) + (order.shippingAmountCents || 0) + (order.taxAmountCents || 0);
            const total = computedTotal > 0
              ? computedTotal
              : order.items.reduce((s, it) => s + it.priceCents * it.quantity, 0);
            const refundAmountCents =
              order.sellerRefundAmountCents ?? latestRefundLedgerEvent(order.paymentEvents)?.amountCents ?? null;

            return (
              <li key={order.id} className="border border-neutral-200">
                {/* Order header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 bg-stone-50">
                  <div className="text-sm">
                    <span className="text-neutral-500 text-xs">Order</span>{" "}
                    <span className="font-mono text-xs text-neutral-700">{order.id.slice(-8).toUpperCase()}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-neutral-500">
                      <LocalDate date={order.createdAt} />
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(order.fulfillmentStatus)}`}>
                      {formatStatus(order.fulfillmentStatus)}
                    </span>
                  </div>
                </div>

                {/* Items */}
                <ul className="divide-y divide-neutral-100">
                  {order.items.map((item) => {
                    const thumb = item.listing.photos[0]?.url;
                    return (
                      <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="h-12 w-12 object-cover border border-neutral-200 shrink-0" />
                        ) : (
                          <div className="h-12 w-12 bg-neutral-100 border border-neutral-200 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <Link
                            href={publicListingPath(item.listing.id, item.listing.title)}
                            className="text-sm font-medium hover:underline truncate block"
                          >
                            {item.listing.title}
                          </Link>
                          <p className="text-xs text-neutral-500 mt-0.5">
                            Qty {item.quantity} ·{" "}
                            {(item.priceCents / 100).toLocaleString("en-US", {
                              style: "currency",
                              currency: order.currency,
                            })} each
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* Order footer */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-100">
                  <div className="text-sm">
                    <span className="text-neutral-500">Total: </span>
                    <span className="font-semibold">
                      {(total / 100).toLocaleString("en-US", {
                        style: "currency",
                        currency: order.currency,
                      })}
                    </span>
                    {(refundAmountCents ?? 0) > 0 && (
                      <span className="text-sm text-red-600 ml-2">
                        (Refund: -{(refundAmountCents! / 100).toLocaleString("en-US", {
                          style: "currency",
                          currency: order.currency,
                        })})
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {order.labelTrackingNumber && (
                      <span className="text-xs text-neutral-500">
                        {order.labelCarrier} · {order.labelTrackingNumber}
                      </span>
                    )}
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="text-xs border border-neutral-200 px-3 py-1 hover:bg-neutral-50 transition-colors"
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
          {page > 1 && (
            <Link
              href={`/account/orders?page=${page - 1}`}
              className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
            >
              ← Previous
            </Link>
          )}
          <span className="text-sm text-neutral-600">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/account/orders?page=${page + 1}`}
              className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
