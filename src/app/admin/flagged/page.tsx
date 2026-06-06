import { prisma } from "@/lib/db";
import Link from "next/link";
import { orderTotalCents } from "@/lib/orderTotals";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { requireAdminPageAccess } from "@/lib/adminPageAccess";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";

const PAGE_SIZE = 25;

function fmtMoney(cents: number | null | undefined, currency = DEFAULT_CURRENCY) {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export default async function FlaggedOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireAdminPageAccess();
  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);

  const where = { reviewNeeded: true } as const;

  const total = await prisma.order.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(requestedPage, totalPages);
  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (safePage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      buyer: { select: { name: true, email: true } },
      items: {
        include: {
          listing: {
            select: {
              title: true,
              seller: { select: { id: true, displayName: true } },
            },
          },
        },
      },
    },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Orders Needing Review</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Orders that need staff reconciliation after payment, shipping, refund, dispute, or checkout review events.
      </p>

      {total === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-16 text-center text-neutral-500">
          No orders needing review
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Orders needing staff reconciliation</caption>
              <thead className="border-b border-neutral-100 bg-neutral-50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium text-neutral-500">Order</th>
                  <th scope="col" className="px-4 py-3 font-medium text-neutral-500">Buyer</th>
                  <th scope="col" className="px-4 py-3 font-medium text-neutral-500">Seller</th>
                  <th scope="col" className="px-4 py-3 font-medium text-neutral-500 text-right">Total</th>
                  <th scope="col" className="px-4 py-3 font-medium text-neutral-500 text-right">Quoted Ship</th>
                  <th scope="col" className="px-4 py-3 font-medium text-neutral-500 text-right">Actual Ship</th>
                  <th scope="col" className="px-4 py-3 font-medium text-neutral-500">Mismatch Note</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {orders.map((order) => {
                  const total = orderTotalCents(order);
                  const sellers = Array.from(
                    new Map(
                      order.items.map((item) => [
                        item.listing.seller.id,
                        item.listing.seller.displayName ?? "Unnamed seller",
                      ]),
                    ).values(),
                  );
                  const itemSummary = order.items
                    .slice(0, 3)
                    .map((item) => `${item.quantity}× ${item.listing.title}`)
                    .join(", ");
                  const remainingItems = Math.max(0, order.items.length - 3);
                  const buyer = order.buyer?.name ?? order.buyer?.email ?? "Deleted user";
                  return (
                    <tr key={order.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                        #{order.id.slice(-8)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-800">{buyer}</div>
                        {order.buyerEmail && order.buyer?.name && (
                          <div className="text-xs text-neutral-500">{order.buyerEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        <div className="font-medium">{sellers.length > 0 ? sellers.join(", ") : "—"}</div>
                        <div className="mt-0.5 max-w-xs text-xs text-neutral-500">
                          {itemSummary}
                          {remainingItems > 0 ? `, +${remainingItems} more` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {fmtMoney(total, order.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-neutral-500">
                        {fmtMoney(order.quotedShippingAmountCents, order.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {fmtMoney(order.shippingAmountCents, order.currency)}
                      </td>
                      <td className="px-4 py-3 text-neutral-600 max-w-xs">
                        <span className="line-clamp-2">{order.reviewNote ?? "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="text-blue-600 hover:underline text-xs whitespace-nowrap"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between text-sm text-neutral-500">
            <span>
              {total} order{total !== 1 ? "s" : ""} needing review · Page {safePage} of {totalPages}
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
    </div>
  );
}
