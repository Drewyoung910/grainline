import { prisma } from "@/lib/db";
import Link from "next/link";

const PAGE_SIZE = 25;

function fmtMoney(cents: number | null | undefined, currency = "usd") {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
}

export default async function FlaggedOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const where = { reviewNeeded: true } as const;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: {
        buyer: { select: { name: true, email: true } },
        items: {
          take: 1,
          include: {
            listing: {
              select: { seller: { select: { displayName: true } } },
            },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Flagged Orders</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Orders where the shipping address or rate changed between quote and checkout.
      </p>

      {total === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-16 text-center text-neutral-400">
          No flagged orders
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-neutral-200 bg-white overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium text-neutral-500">Order</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Buyer</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Seller</th>
                  <th className="px-4 py-3 font-medium text-neutral-500 text-right">Total</th>
                  <th className="px-4 py-3 font-medium text-neutral-500 text-right">Quoted Ship</th>
                  <th className="px-4 py-3 font-medium text-neutral-500 text-right">Actual Ship</th>
                  <th className="px-4 py-3 font-medium text-neutral-500">Mismatch Note</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {orders.map((order) => {
                  const total =
                    (order.itemsSubtotalCents ?? 0) +
                    (order.shippingAmountCents ?? 0) +
                    (order.taxAmountCents ?? 0);
                  const seller = order.items[0]?.listing.seller.displayName ?? "—";
                  const buyer = order.buyer.name ?? order.buyer.email;
                  return (
                    <tr key={order.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                        #{order.id.slice(-8)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-800">{buyer}</div>
                        {order.buyerEmail && order.buyer.name && (
                          <div className="text-xs text-neutral-400">{order.buyerEmail}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{seller}</td>
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
              {total} flagged order{total !== 1 ? "s" : ""} · Page {safePage} of {totalPages}
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
