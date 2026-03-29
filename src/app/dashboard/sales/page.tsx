// src/app/dashboard/sales/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { FulfillmentStatus } from "@prisma/client";

const PAGE_SIZE = 25;

function fmtMoney(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  });
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
      {status.replaceAll("_", " ")}
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
    select: { id: true, displayName: true },
  });
  if (!seller) redirect("/dashboard/seller");

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const where = { items: { some: { listing: { sellerId: seller.id } } } } as const;

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
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
        buyer: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    prisma.order.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  return (
    <main className="mx-auto max-w-5xl p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">My sales</h1>
        <p className="text-sm text-neutral-600">Orders containing your listings.</p>
      </header>

      {total === 0 ? (
        <div className="rounded-xl border p-8 text-neutral-600">No orders yet — your first sale is right around the corner 🪵</div>
      ) : (
        <>
          <ul className="space-y-4">
            {orders.map((o) => {
              const myItems = o.items.filter((it) => it.listing.seller.id === seller.id);
              const mySubtotalCents = myItems.reduce(
                (s, it) => s + it.priceCents * it.quantity,
                0
              );
              const currency = o.currency ?? "usd";
              const shipping = o.shippingAmountCents ?? 0;
              const tax = o.taxAmountCents ?? 0;
              const orderTotal =
                (o.itemsSubtotalCents || mySubtotalCents) + shipping + tax;
              const status = o.fulfillmentStatus ?? "PENDING";

              return (
                <li key={o.id} className="rounded-xl border bg-white">
                  <div className="flex items-center justify-between border-b px-4 py-3">
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
                        {o.createdAt.toLocaleString()}
                        {o.paidAt ? " · Paid" : " · Unpaid"}
                      </div>
                      <div className="text-xs text-neutral-500">
                        Buyer: {o.buyer.name ?? o.buyer.email}
                      </div>
                    </div>
                    <div className="text-sm font-semibold">
                      {fmtMoney(orderTotal, currency)}
                    </div>
                  </div>

                  <ul className="divide-y">
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
                              href={`/listing/${it.listingId}`}
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

                  <div className="px-4 py-3 border-t text-sm space-y-2">
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
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-neutral-800">Order total</span>
                      <span className="text-base font-semibold">
                        {fmtMoney(orderTotal, currency)}
                      </span>
                    </div>
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
