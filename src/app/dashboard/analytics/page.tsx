// src/app/dashboard/analytics/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureSeller } from "@/lib/ensureSeller";
import { calculateSellerMetrics, meetsGuildMasterRequirements } from "@/lib/metrics";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Analytics",
};

function fmtCurrency(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency });
}

function pct(ratio: number) {
  return (ratio * 100).toFixed(1) + "%";
}

function colorRate(ratio: number, greenThreshold: number, amberThreshold: number) {
  if (ratio >= greenThreshold) return "text-green-700";
  if (ratio >= amberThreshold) return "text-amber-600";
  return "text-red-600";
}

export default async function AnalyticsPage() {
  const { seller, me } = await ensureSeller();

  // Check if SellerMetrics is stale (>24h) or missing — recalculate if so
  const existingMetrics = await prisma.sellerMetrics.findUnique({
    where: { sellerProfileId: seller.id },
    select: { calculatedAt: true },
  });
  const isStale =
    !existingMetrics ||
    Date.now() - new Date(existingMetrics.calculatedAt).getTime() > 24 * 60 * 60 * 1000;

  const metrics = isStale
    ? await calculateSellerMetrics(seller.id)
    : await prisma.sellerMetrics.findUnique({
        where: { sellerProfileId: seller.id },
      }).then((m) => m ?? calculateSellerMetrics(seller.id));

  // Fetch active listing count
  const activeListingCount = await prisma.listing.count({
    where: { sellerId: seller.id, status: "ACTIVE" },
  });

  // Revenue + order count (completed orders)
  const avgOrderValue =
    metrics.completedOrderCount > 0
      ? Math.round(metrics.totalSalesCents / metrics.completedOrderCount)
      : 0;

  // Recent 10 sales (completed orders with items)
  const recentSales = await prisma.order.findMany({
    where: {
      items: { some: { listing: { sellerId: seller.id } } },
      paidAt: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      itemsSubtotalCents: true,
      shippingAmountCents: true,
      taxAmountCents: true,
      currency: true,
      fulfillmentStatus: true,
      buyer: { select: { name: true } },
      items: {
        where: { listing: { sellerId: seller.id } },
        take: 1,
        select: {
          listing: { select: { title: true } },
        },
      },
    },
  });

  // Top 5 listings by revenue (all-time completed orders)
  type TopListingRow = {
    id: string;
    title: string;
    photoUrl: string | null;
    unitsSold: bigint;
    revenueCents: bigint;
    avgPriceCents: bigint;
  };

  const topListings = await prisma.$queryRaw<TopListingRow[]>`
    SELECT
      l.id,
      l.title,
      (SELECT p.url FROM "Photo" p WHERE p."listingId" = l.id ORDER BY p."sortOrder" ASC LIMIT 1) AS "photoUrl",
      SUM(oi.quantity) AS "unitsSold",
      SUM(oi."priceCents" * oi.quantity) AS "revenueCents",
      AVG(oi."priceCents") AS "avgPriceCents"
    FROM "OrderItem" oi
    JOIN "Listing" l ON l.id = oi."listingId"
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE
      l."sellerId" = ${seller.id}
      AND o."fulfillmentStatus" IN ('DELIVERED', 'PICKED_UP')
    GROUP BY l.id, l.title
    ORDER BY "revenueCents" DESC
    LIMIT 5
  `;

  // Monthly revenue for last 6 months (for bar chart)
  type MonthlyRow = { month: string; revenueCents: bigint };
  const monthlyRevenue = await prisma.$queryRaw<MonthlyRow[]>`
    SELECT
      TO_CHAR(o."createdAt", 'YYYY-MM') AS month,
      SUM(oi."priceCents" * oi.quantity) AS "revenueCents"
    FROM "OrderItem" oi
    JOIN "Listing" l ON l.id = oi."listingId"
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE
      l."sellerId" = ${seller.id}
      AND o."fulfillmentStatus" IN ('DELIVERED', 'PICKED_UP')
      AND o."createdAt" >= NOW() - INTERVAL '6 months'
    GROUP BY month
    ORDER BY month ASC
  `;

  const guildCriteria = meetsGuildMasterRequirements(metrics);
  const failingCriteria = Object.entries(guildCriteria)
    .filter(([k, v]) => k !== "allMet" && !v)
    .map(([k]) => k);

  const maxMonthly = monthlyRevenue.reduce(
    (max, r) => Math.max(max, Number(r.revenueCents)),
    1
  );

  function statusLabel(s: string | null) {
    if (!s) return "Processing";
    switch (s) {
      case "PENDING": return "Processing";
      case "READY_FOR_PICKUP": return "Ready";
      case "PICKED_UP": return "Picked Up";
      case "SHIPPED": return "Shipped";
      case "DELIVERED": return "Delivered";
      default: return s;
    }
  }
  function statusColor(s: string | null) {
    switch (s) {
      case "DELIVERED": case "PICKED_UP": return "bg-green-100 text-green-800";
      case "SHIPPED": return "bg-blue-100 text-blue-800";
      default: return "bg-neutral-100 text-neutral-700";
    }
  }

  function criteriaLabel(k: string) {
    switch (k) {
      case "ratingMet": return `Average rating ≥ 4.5 (yours: ${metrics.averageRating.toFixed(1)})`;
      case "reviewsMet": return `≥ 25 reviews (yours: ${metrics.reviewCount})`;
      case "shippingMet": return `On-time shipping ≥ 95% (yours: ${pct(metrics.onTimeShippingRate)})`;
      case "responseMet": return `Response rate ≥ 90% (yours: ${pct(metrics.responseRate)})`;
      case "ageMet": return `Account age ≥ 180 days (yours: ${metrics.accountAgeDays} days)`;
      case "salesMet": return `$1,000 in completed sales (yours: ${fmtCurrency(metrics.totalSalesCents)})`;
      case "casesMet": return `No open cases (yours: ${metrics.activeCaseCount})`;
      default: return k;
    }
  }

  return (
    <main className="max-w-5xl mx-auto p-6 md:p-8 space-y-10">
      {/* ── Header ── */}
      <header>
        <div className="flex items-center gap-4 mb-1">
          <Link href="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-700">
            ← Workshop
          </Link>
          <h1 className="text-3xl font-bold">Analytics</h1>
        </div>
        <p className="text-sm text-neutral-500">
          Last updated: {new Date(metrics.calculatedAt).toLocaleString()} · Metrics cover the last 3 months
        </p>
      </header>

      {/* ── Section A: Overview stats ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="border border-neutral-200 p-5">
            <p className="text-2xl font-bold">{fmtCurrency(metrics.totalSalesCents)}</p>
            <p className="text-xs text-neutral-500 mt-0.5">Total Revenue</p>
          </div>
          <div className="border border-neutral-200 p-5">
            <p className="text-2xl font-bold">{metrics.completedOrderCount}</p>
            <p className="text-xs text-neutral-500 mt-0.5">Total Orders</p>
          </div>
          <div className="border border-neutral-200 p-5">
            <p className="text-2xl font-bold">{fmtCurrency(avgOrderValue)}</p>
            <p className="text-xs text-neutral-500 mt-0.5">Avg. Order Value</p>
          </div>
          <div className="border border-neutral-200 p-5">
            <p className="text-2xl font-bold">{activeListingCount}</p>
            <p className="text-xs text-neutral-500 mt-0.5">Active Listings</p>
          </div>
        </div>
      </section>

      {/* ── Section B: Guild Metrics ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Guild Metrics</h2>
        <div className="border border-neutral-200 divide-y divide-neutral-100">
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-neutral-600">Average Rating</span>
            <span className="font-semibold">
              {metrics.reviewCount > 0 ? (
                <>{metrics.averageRating.toFixed(1)} ★ <span className="text-xs text-neutral-400 font-normal">({metrics.reviewCount} reviews)</span></>
              ) : (
                <span className="text-neutral-400 text-sm">No reviews yet</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-neutral-600">On-Time Shipping</span>
            <span className={`font-semibold ${colorRate(metrics.onTimeShippingRate, 0.95, 0.80)}`}>
              {pct(metrics.onTimeShippingRate)}
            </span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-neutral-600">Response Rate</span>
            <span className={`font-semibold ${colorRate(metrics.responseRate, 0.90, 0.70)}`}>
              {pct(metrics.responseRate)}
            </span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-neutral-600">Account Age</span>
            <span className="font-semibold">{metrics.accountAgeDays} days</span>
          </div>
          <div className="flex items-center justify-between px-5 py-3">
            <span className="text-sm text-neutral-600">Open Cases</span>
            <span className={`font-semibold ${metrics.activeCaseCount === 0 ? "text-green-700" : "text-red-600"}`}>
              {metrics.activeCaseCount}
            </span>
          </div>
        </div>

        {/* Guild Master eligibility */}
        <div className="mt-4">
          {guildCriteria.allMet ? (
            <div className="border border-amber-300 bg-amber-50 px-5 py-3 flex items-center justify-between">
              <p className="text-sm text-amber-900 font-medium">You qualify for Guild Master!</p>
              <Link href="/dashboard/verification" className="text-xs border border-amber-400 px-3 py-1.5 text-amber-900 hover:bg-amber-100 transition-colors">
                Apply →
              </Link>
            </div>
          ) : failingCriteria.length > 0 ? (
            <div className="border border-neutral-200 px-5 py-3">
              <p className="text-sm font-medium text-neutral-700 mb-2">Guild Master criteria not yet met:</p>
              <ul className="space-y-1">
                {failingCriteria.map((k) => (
                  <li key={k} className="text-xs text-neutral-600 flex gap-2">
                    <span className="text-red-500">✗</span>
                    {criteriaLabel(k)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Section C: Recent Sales ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Recent Sales</h2>
          <Link href="/dashboard/sales" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View all sales →
          </Link>
        </div>

        {recentSales.length === 0 ? (
          <div className="border border-neutral-200 p-6 text-sm text-neutral-500">
            No completed sales yet.
          </div>
        ) : (
          <div className="border border-neutral-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-neutral-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-neutral-600">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-neutral-600">Item</th>
                  <th className="text-left px-4 py-2 font-medium text-neutral-600 hidden sm:table-cell">Buyer</th>
                  <th className="text-right px-4 py-2 font-medium text-neutral-600">Amount</th>
                  <th className="text-left px-4 py-2 font-medium text-neutral-600 hidden md:table-cell">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {recentSales.map((order) => {
                  const total = order.itemsSubtotalCents + order.shippingAmountCents + order.taxAmountCents;
                  const title = order.items[0]?.listing.title ?? "Order";
                  const buyerFirstName = order.buyer?.name?.split(" ")[0] ?? "Buyer";
                  return (
                    <tr key={order.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2 text-neutral-500 whitespace-nowrap">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 max-w-[180px] truncate">
                        <Link href={`/dashboard/sales/${order.id}`} className="hover:underline">
                          {title}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-neutral-600 hidden sm:table-cell">
                        {buyerFirstName}
                      </td>
                      <td className="px-4 py-2 text-right font-medium whitespace-nowrap">
                        {fmtCurrency(total, order.currency)}
                      </td>
                      <td className="px-4 py-2 hidden md:table-cell">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(order.fulfillmentStatus)}`}>
                          {statusLabel(order.fulfillmentStatus)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section D: Top Listings ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Top Listings</h2>
        {topListings.length === 0 ? (
          <div className="border border-neutral-200 p-6 text-sm text-neutral-500">
            No completed sales data yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {topListings.map((l) => (
              <li key={l.id} className="border border-neutral-200 flex items-center gap-4 p-3">
                {l.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.photoUrl} alt="" className="h-12 w-12 object-cover border border-neutral-200 shrink-0" />
                ) : (
                  <div className="h-12 w-12 bg-neutral-100 border border-neutral-200 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <Link href={`/listing/${l.id}`} className="text-sm font-medium hover:underline truncate block">
                    {l.title}
                  </Link>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {Number(l.unitsSold)} units sold · avg {fmtCurrency(Number(l.avgPriceCents))}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{fmtCurrency(Number(l.revenueCents))}</p>
                  <p className="text-xs text-neutral-400">revenue</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Section E: Monthly Revenue ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Sales Over Time</h2>
        {monthlyRevenue.length === 0 ? (
          <div className="border border-neutral-200 p-6 text-sm text-neutral-500">
            No sales data for the last 6 months.
          </div>
        ) : (
          <div className="border border-neutral-200 p-5">
            <div className="flex items-end gap-3 h-40">
              {monthlyRevenue.map((r) => {
                const height = Math.max(4, Math.round((Number(r.revenueCents) / maxMonthly) * 100));
                const [year, monthNum] = r.month.split("-");
                const monthLabel = new Date(Number(year), Number(monthNum) - 1, 1).toLocaleString(undefined, { month: "short" });
                return (
                  <div key={r.month} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                    <p className="text-xs text-neutral-500 whitespace-nowrap">{fmtCurrency(Number(r.revenueCents))}</p>
                    <div
                      className="w-full bg-amber-400 hover:bg-amber-500 transition-colors"
                      style={{ height: `${height}%` }}
                      title={`${monthLabel}: ${fmtCurrency(Number(r.revenueCents))}`}
                    />
                    <p className="text-xs text-neutral-500">{monthLabel}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
