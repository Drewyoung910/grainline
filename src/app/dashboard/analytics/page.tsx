"use client";
// src/app/dashboard/analytics/page.tsx

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────────────────────────

type RangeKey = "today" | "yesterday" | "week" | "month" | "last30" | "year" | "last365" | "alltime";
type ChartMetric = "revenue" | "orders" | "views" | "clicks";

type ChartBucket = {
  label: string;
  timestamp: string;
  revenue: number;
  orders: number;
  views: number;
  clicks: number;
};

type TopListing = {
  id: string;
  title: string;
  imageUrl: string | null;
  totalRevenueCents: number;
  unitsSold: number;
  avgPriceCents: number;
  viewCount: number;
  clickCount: number;
  favoritesCount: number;
  stockNotificationCount: number;
  revenuePerActiveDayCents: number;
};

type GuildMetrics = {
  averageRating: number;
  reviewCount: number;
  onTimeShippingRate: number;
  responseRate: number;
  accountAgeDays: number;
  activeCaseCount: number;
  totalSalesCents: number;
  lastCalculatedAt: string | null;
};

type AnalyticsData = {
  range: RangeKey;
  startDate: string;
  endDate: string;
  chartGrouping: "hour" | "day" | "month";
  overview: {
    totalRevenueCents: number;
    totalOrders: number;
    avgOrderValueCents: number;
    activeListings: number;
  };
  engagement: {
    totalViews: number;
    totalClicks: number;
    profileVisits: number;
    viewToClickRatio: number;
    conversionRate: number;
    cartAbandonment: number;
    stockNotificationSubs: number;
    favoritesCount: number;
  };
  repeatBuyerRate: number;
  avgProcessingHours: number | null;
  chartData: ChartBucket[];
  topListings: TopListing[];
  ratingOverTime: Array<{ label: string; avgRating: number; reviewCount: number }>;
  guildMetrics: GuildMetrics;
  guildMasterMet: boolean;
  guildMasterFailures: string[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtExact(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency });
}

function pct(val: number, decimals = 1) {
  return val.toFixed(decimals) + "%";
}

function colorRate(val: number, greenThresh: number, amberThresh: number) {
  if (val >= greenThresh) return "text-green-700";
  if (val >= amberThresh) return "text-amber-600";
  return "text-red-600";
}

// ── Skeleton ────────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

// ── Chart ───────────────────────────────────────────────────────────────────────

function BarChartSection({
  chartData,
  metric,
  onMetricChange,
}: {
  chartData: ChartBucket[];
  metric: ChartMetric;
  onMetricChange: (m: ChartMetric) => void;
}) {
  const [tooltip, setTooltip] = useState<{ label: string; value: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const values = chartData.map((b) => b[metric]);
  const maxVal = Math.max(...values, 1);
  const hasData = values.some((v) => v > 0);
  const manyBuckets = chartData.length > 14;

  const metricColors: Record<ChartMetric, string> = {
    revenue: "bg-amber-400 hover:bg-amber-500",
    orders: "bg-indigo-400 hover:bg-indigo-500",
    views: "bg-teal-400 hover:bg-teal-500",
    clicks: "bg-orange-400 hover:bg-orange-500",
  };

  const yLabels = [maxVal, Math.round(maxVal * 0.75), Math.round(maxVal * 0.5), Math.round(maxVal * 0.25), 0];

  function formatValue(v: number) {
    if (metric === "revenue") return fmtExact(v);
    return v.toLocaleString();
  }

  const metrics: { key: ChartMetric; label: string }[] = [
    { key: "revenue", label: "Revenue" },
    { key: "orders", label: "Orders" },
    { key: "views", label: "Views" },
    { key: "clicks", label: "Clicks" },
  ];

  return (
    <section>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-xl font-semibold">Performance Over Time</h2>
        <div className="flex gap-2">
          {metrics.map((m) => (
            <button
              key={m.key}
              onClick={() => onMetricChange(m.key)}
              className={`text-xs px-3 py-1.5 border font-medium transition-colors ${
                metric === m.key
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-neutral-200 p-4 relative" ref={containerRef}>
        {!hasData && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-neutral-400">No data for this period</p>
          </div>
        )}

        {/* Y axis + chart area */}
        <div className="flex gap-2">
          {/* Y axis labels */}
          <div className="flex flex-col justify-between text-right shrink-0 w-12 text-[10px] text-neutral-400" style={{ height: 180 }}>
            {yLabels.map((v, i) => (
              <span key={i}>
                {metric === "revenue" ? `$${Math.round(v / 100).toLocaleString()}` : v.toLocaleString()}
              </span>
            ))}
          </div>

          {/* Bars */}
          <div className="flex-1 relative">
            {/* Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ height: 180 }}>
              {yLabels.map((_, i) => (
                <div key={i} className="border-t border-neutral-100 w-full" />
              ))}
            </div>

            {/* Bar columns */}
            <div className="flex items-end gap-px overflow-x-auto" style={{ height: 180 }}>
              {chartData.map((b) => {
                const val = b[metric];
                const heightPct = Math.max(val > 0 ? 4 : 0, Math.round((val / maxVal) * 100));
                return (
                  <div
                    key={b.timestamp}
                    className="flex-1 flex flex-col items-center justify-end min-w-[4px] cursor-pointer"
                    style={{ height: "100%" }}
                    onMouseEnter={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const containerRect = containerRef.current?.getBoundingClientRect();
                      if (containerRect) {
                        setTooltip({
                          label: b.label,
                          value: formatValue(val),
                          x: rect.left - containerRect.left + rect.width / 2,
                          y: rect.top - containerRect.top - 8,
                        });
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  >
                    <div
                      className={`w-full transition-colors ${metricColors[metric]}`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* X axis labels */}
        <div className="flex gap-px ml-14 mt-1 overflow-x-hidden">
          {chartData.map((b, i) => {
            const showEvery = manyBuckets ? Math.ceil(chartData.length / 14) : 1;
            const show = i % showEvery === 0 || i === chartData.length - 1;
            return (
              <div
                key={b.timestamp}
                className={`flex-1 min-w-[4px] text-center overflow-hidden ${manyBuckets ? "-rotate-45 origin-top-left" : ""}`}
              >
                {show && (
                  <span className="text-[9px] text-neutral-400 whitespace-nowrap">{b.label}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none bg-neutral-900 text-white text-xs px-2 py-1 rounded shadow-md whitespace-nowrap"
            style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
          >
            <div className="font-medium">{tooltip.label}</div>
            <div>{tooltip.value}</div>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
  { key: "year", label: "This year" },
  { key: "last365", label: "Last 365 days" },
  { key: "alltime", label: "All time" },
];

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeKey>("last30");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("revenue");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/seller/analytics?range=${range}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load analytics");
        return r.json();
      })
      .then((d: AnalyticsData) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError((e as Error).message);
        setLoading(false);
      });
  }, [range]);

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8 space-y-10">
      {/* ── Header ── */}
      <header>
        <div className="flex items-center gap-4 mb-1">
          <Link href="/dashboard" className="text-sm text-neutral-500 hover:text-neutral-700">
            ← Workshop
          </Link>
          <h1 className="text-3xl font-bold">Analytics</h1>
        </div>

        {/* Range selector */}
        <div className="mt-4 flex overflow-x-auto gap-2 pb-1">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`shrink-0 text-sm px-3 py-1.5 border font-medium transition-colors ${
                range === r.key
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {error && (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Section A: Overview ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Overview</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {loading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : data ? (
            <>
              <div className="border border-neutral-200 p-5">
                <p className="text-2xl font-bold">{fmt(data.overview.totalRevenueCents)}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Total Revenue</p>
              </div>
              <div className="border border-neutral-200 p-5">
                <p className="text-2xl font-bold">{data.overview.totalOrders.toLocaleString()}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Total Orders</p>
              </div>
              <div className="border border-neutral-200 p-5">
                <p className="text-2xl font-bold">{fmt(data.overview.avgOrderValueCents)}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Avg. Order Value</p>
              </div>
              <div className="border border-neutral-200 p-5">
                <p className="text-2xl font-bold">{data.overview.activeListings}</p>
                <p className="text-xs text-neutral-500 mt-0.5">Active Listings</p>
              </div>
            </>
          ) : null}
        </div>
      </section>

      {/* ── Section B: Engagement ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Engagement</h2>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : data ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[
              { label: "Impressions", value: data.engagement.totalViews.toLocaleString(), note: "total views on listings" },
              { label: "Clicks", value: data.engagement.totalClicks.toLocaleString(), note: "listing card clicks" },
              { label: "Profile Visits", value: data.engagement.profileVisits.toLocaleString(), note: "all-time" },
              { label: "Click Rate", value: pct(data.engagement.viewToClickRatio), note: "views → clicks" },
              { label: "Conversion", value: pct(data.engagement.conversionRate, 2), note: "orders ÷ views" },
              { label: "Saved", value: data.engagement.favoritesCount.toLocaleString(), note: "total favorites" },
              { label: "Watching", value: data.engagement.stockNotificationSubs.toLocaleString(), note: "stock alerts" },
              { label: "Cart Abandoned", value: data.engagement.cartAbandonment.toLocaleString(), note: "added, not bought" },
              { label: "Repeat Buyers", value: pct(data.repeatBuyerRate), note: "bought more than once" },
              {
                label: "Avg Processing",
                value: data.avgProcessingHours != null
                  ? data.avgProcessingHours >= 48
                    ? `${(data.avgProcessingHours / 24).toFixed(1)} days`
                    : `${data.avgProcessingHours.toFixed(1)} hrs`
                  : "—",
                note: "order to shipped",
              },
            ].map((stat) => (
              <div key={stat.label} className="border border-neutral-200 p-3">
                <p className="text-xl font-bold">{stat.value}</p>
                <p className="text-xs font-medium text-neutral-700 mt-0.5">{stat.label}</p>
                <p className="text-[10px] text-neutral-400">{stat.note}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* ── Section C: Chart ── */}
      <section>
        {loading ? (
          <Skeleton className="h-60 w-full" />
        ) : data ? (
          <BarChartSection
            chartData={data.chartData}
            metric={chartMetric}
            onMetricChange={setChartMetric}
          />
        ) : null}
      </section>

      {/* ── Section D: Top Listings ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Top Listings</h2>
          <Link href="/dashboard/listings" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View all →
          </Link>
        </div>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
          </div>
        ) : data ? (
          data.topListings.length === 0 ? (
            <div className="border border-neutral-200 p-6 text-sm text-neutral-500">No sales data yet.</div>
          ) : (
            <ul className="divide-y border border-neutral-200">
              {data.topListings.slice(0, 5).map((l) => (
                <li key={l.id} className="flex items-center gap-4 p-3">
                  {l.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.imageUrl} alt="" className="h-20 w-20 object-cover border border-neutral-200 shrink-0" />
                  ) : (
                    <div className="h-20 w-20 bg-neutral-100 border border-neutral-200 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <Link href={`/listing/${l.id}`} className="text-sm font-medium hover:underline truncate block">
                      {l.title}
                    </Link>
                    <p className="text-xs text-neutral-600 mt-0.5">
                      {fmtExact(l.totalRevenueCents)} total · {l.unitsSold} units · avg {fmt(l.avgPriceCents)}
                    </p>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      👁 {l.viewCount.toLocaleString()} · 🖱 {l.clickCount.toLocaleString()} · ♥ {l.favoritesCount} · 🔔 {l.stockNotificationCount}
                      {l.revenuePerActiveDayCents > 0 && (
                        <> · <span className="text-neutral-500">{fmtExact(l.revenuePerActiveDayCents)}/day</span></>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{fmt(l.totalRevenueCents)}</p>
                    <p className="text-xs text-neutral-400">revenue</p>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      {/* ── Section E: Guild Metrics ── */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Guild Metrics</h2>
        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : data ? (
          <>
            <div className="border border-neutral-200 divide-y divide-neutral-100">
              {[
                {
                  label: "Average Rating",
                  value: data.guildMetrics.reviewCount > 0
                    ? `${data.guildMetrics.averageRating.toFixed(1)} ★ (${data.guildMetrics.reviewCount} reviews)`
                    : "No reviews yet",
                  className: "",
                },
                {
                  label: "On-Time Shipping",
                  value: pct(data.guildMetrics.onTimeShippingRate * 100),
                  className: colorRate(data.guildMetrics.onTimeShippingRate, 0.95, 0.80),
                },
                {
                  label: "Response Rate",
                  value: pct(data.guildMetrics.responseRate * 100),
                  className: colorRate(data.guildMetrics.responseRate, 0.90, 0.70),
                },
                {
                  label: "Account Age",
                  value: `${data.guildMetrics.accountAgeDays} days`,
                  className: "",
                },
                {
                  label: "Open Cases",
                  value: String(data.guildMetrics.activeCaseCount),
                  className: data.guildMetrics.activeCaseCount === 0 ? "text-green-700" : "text-red-600",
                },
                {
                  label: "Completed Sales",
                  value: fmtExact(data.guildMetrics.totalSalesCents),
                  className: "",
                },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between px-5 py-3">
                  <span className="text-sm text-neutral-600">{row.label}</span>
                  <span className={`font-semibold ${row.className}`}>{row.value}</span>
                </div>
              ))}
            </div>
            {data.guildMetrics.lastCalculatedAt && (
              <p className="text-xs text-neutral-400 mt-1">
                Last updated: {new Date(data.guildMetrics.lastCalculatedAt).toLocaleString()}
              </p>
            )}

            <div className="mt-3">
              {data.guildMasterMet ? (
                <div className="border border-amber-300 bg-amber-50 px-5 py-3 flex items-center justify-between">
                  <p className="text-sm text-amber-900 font-medium">You qualify for Guild Master!</p>
                  <Link href="/dashboard/verification" className="text-xs border border-amber-400 px-3 py-1.5 text-amber-900 hover:bg-amber-100 transition-colors">
                    Apply →
                  </Link>
                </div>
              ) : data.guildMasterFailures.length > 0 ? (
                <div className="border border-neutral-200 px-5 py-3">
                  <p className="text-sm font-medium text-neutral-700 mb-2">Guild Master criteria not yet met:</p>
                  <ul className="space-y-1">
                    {data.guildMasterFailures.map((f) => (
                      <li key={f} className="text-xs text-neutral-600 flex gap-2">
                        <span className="text-red-500">✗</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </section>

      {/* ── Section F: Rating Over Time ── */}
      {!loading && data && data.ratingOverTime.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold mb-4">Rating Over Time</h2>
          <div className="border border-neutral-200 divide-y divide-neutral-100">
            {data.ratingOverTime.map((r) => (
              <div key={r.label} className="flex items-center justify-between px-5 py-2 text-sm">
                <span className="text-neutral-600">{r.label}</span>
                <span className="font-medium">
                  {r.avgRating.toFixed(1)} ★
                  <span className="text-xs text-neutral-400 font-normal ml-1">({r.reviewCount} review{r.reviewCount !== 1 ? "s" : ""})</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Section G: Recent Sales ── */}
      <RecentSales />
    </main>
  );
}

// Recent sales is a separate sub-component to keep things clean
function RecentSales() {
  const [sales, setSales] = useState<null | {
    id: string;
    createdAt: string;
    itemsSubtotalCents: number;
    shippingAmountCents: number;
    taxAmountCents: number;
    currency: string;
    fulfillmentStatus: string | null;
    buyer: { name: string | null } | null;
    items: Array<{ listing: { title: string } }>;
  }[]>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/seller/analytics/recent-sales")
      .then((r) => r.json())
      .then((d) => { setSales(d.sales ?? []); setLoading(false); })
      .catch(() => { setSales([]); setLoading(false); });
  }, []);

  function statusLabel(s: string | null) {
    switch (s) {
      case "PENDING": return "Processing";
      case "READY_FOR_PICKUP": return "Ready";
      case "PICKED_UP": return "Picked Up";
      case "SHIPPED": return "Shipped";
      case "DELIVERED": return "Delivered";
      default: return "Processing";
    }
  }
  function statusColor(s: string | null) {
    switch (s) {
      case "DELIVERED": case "PICKED_UP": return "bg-green-100 text-green-800";
      case "SHIPPED": return "bg-blue-100 text-blue-800";
      default: return "bg-neutral-100 text-neutral-700";
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Recent Sales</h2>
        <Link href="/dashboard/sales" className="text-sm text-neutral-600 underline hover:text-neutral-900">
          View all sales →
        </Link>
      </div>
      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : !sales || sales.length === 0 ? (
        <div className="border border-neutral-200 p-6 text-sm text-neutral-500">No completed sales yet.</div>
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
              {sales.map((order) => {
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
                    <td className="px-4 py-2 text-neutral-600 hidden sm:table-cell">{buyerFirstName}</td>
                    <td className="px-4 py-2 text-right font-medium whitespace-nowrap">
                      {fmtExact(total, order.currency)}
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
  );
}
