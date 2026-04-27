// src/app/api/seller/analytics/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { calculateSellerMetrics, meetsGuildMasterRequirements } from "@/lib/metrics";

export const runtime = "nodejs";

type RangeKey = "today" | "yesterday" | "week" | "last7" | "month" | "last30" | "year" | "last365" | "alltime";
type ChartGrouping = "hour" | "day" | "month" | "year";

function getRangeDates(
  range: RangeKey,
  sellerCreatedAt?: Date,
): { startDate: Date; endDate: Date; chartGrouping: ChartGrouping } {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (range) {
    case "today":
      return { startDate: todayStart, endDate: now, chartGrouping: "hour" };
    case "yesterday": {
      const yStart = new Date(todayStart);
      yStart.setUTCDate(yStart.getUTCDate() - 1);
      const yEnd = new Date(todayStart);
      return { startDate: yStart, endDate: yEnd, chartGrouping: "hour" };
    }
    case "week": {
      const weekStart = new Date(todayStart);
      const day = weekStart.getUTCDay(); // 0=Sun
      weekStart.setUTCDate(weekStart.getUTCDate() - ((day + 6) % 7)); // Monday
      return { startDate: weekStart, endDate: now, chartGrouping: "day" };
    }
    case "last7": {
      const s = new Date(todayStart);
      s.setUTCDate(s.getUTCDate() - 6); // 7 days including today
      return { startDate: s, endDate: now, chartGrouping: "day" };
    }
    case "month": {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { startDate: monthStart, endDate: now, chartGrouping: "day" };
    }
    case "last30": {
      const s = new Date(todayStart);
      s.setUTCDate(s.getUTCDate() - 30);
      return { startDate: s, endDate: now, chartGrouping: "day" };
    }
    case "year": {
      const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { startDate: yearStart, endDate: now, chartGrouping: "month" };
    }
    case "last365": {
      const s = new Date(todayStart);
      s.setUTCDate(s.getUTCDate() - 365);
      return { startDate: s, endDate: now, chartGrouping: "month" };
    }
    case "alltime":
    default:
      return {
        startDate: sellerCreatedAt ?? new Date("2020-01-01T00:00:00Z"),
        endDate: now,
        chartGrouping: "year",
      };
  }
}

// Always generate all 24 hours — no break guard on endDate
function generateHourBuckets(startDate: Date): { label: string; timestamp: string }[] {
  const buckets: { label: string; timestamp: string }[] = [];
  for (let h = 0; h < 24; h++) {
    const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(), h));
    const hour = h % 12 || 12;
    const ampm = h < 12 ? "am" : "pm";
    buckets.push({ label: `${hour}${ampm}`, timestamp: d.toISOString() });
  }
  return buckets;
}

function distributeCountEvenly(total: number, bucketCount: number, index: number) {
  if (bucketCount <= 0 || index < 0 || index >= bucketCount) return 0;
  const previous = Math.round((total * index) / bucketCount);
  const next = Math.round((total * (index + 1)) / bucketCount);
  return next - previous;
}

// For "week" range: always 7 days Mon-Sun with day-of-week labels
function generateWeekBuckets(weekStart: Date): { label: string; timestamp: string }[] {
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return DAYS.map((label, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return { label, timestamp: d.toISOString() };
  });
}

function generateDayBuckets(startDate: Date, endDate: Date): { label: string; timestamp: string }[] {
  const buckets: { label: string; timestamp: string }[] = [];
  const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  while (cur <= end) {
    const label = cur.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    buckets.push({ label, timestamp: cur.toISOString() });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return buckets;
}

// Short month labels: 'Jan', 'Feb', etc.
function generateMonthBuckets(startDate: Date, endDate: Date): { label: string; timestamp: string }[] {
  const buckets: { label: string; timestamp: string }[] = [];
  const cur = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  const endMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  while (cur <= endMonth) {
    const label = cur.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    buckets.push({ label, timestamp: cur.toISOString() });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return buckets;
}

// Year buckets for alltime: labeled '2024', '2025', etc.
function generateYearBuckets(startDate: Date, endDate: Date): { label: string; timestamp: string }[] {
  const buckets: { label: string; timestamp: string }[] = [];
  const startYear = startDate.getUTCFullYear();
  const endYear = endDate.getUTCFullYear();
  for (let y = startYear; y <= endYear; y++) {
    const d = new Date(Date.UTC(y, 0, 1));
    buckets.push({ label: String(y), timestamp: d.toISOString() });
  }
  return buckets;
}

type OrderRowHour = { bucket: number; revenue: bigint; orders: bigint };
type OrderRowDay = { bucket: Date; revenue: bigint; orders: bigint };
type OrderRowMonth = { bucket: Date; revenue: bigint; orders: bigint };
type OrderRowYear = { bucket: Date; revenue: bigint; orders: bigint };

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const me = await ensureUserByClerkId(userId);
    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: {
        id: true,
        createdAt: true,
        profileViews: true,
      },
    });
    if (!sellerProfile) return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });

    const sellerId = sellerProfile.id;

    const url = new URL(req.url);
    const rangeParam = url.searchParams.get("range") ?? "last30";
    const validRanges: RangeKey[] = ["today", "yesterday", "week", "last7", "month", "last30", "year", "last365", "alltime"];
    const range = validRanges.includes(rangeParam as RangeKey) ? (rangeParam as RangeKey) : "last30";

    const { startDate, endDate, chartGrouping } = getRangeDates(range, new Date(sellerProfile.createdAt));

    // ── Queries in parallel ─────────────────────────────────────────────────────

    // Overview: revenue + orders in range
    type OverviewRow = { total_revenue: bigint | null; total_orders: bigint };
    const [overviewRows, activeListingCount] = await Promise.all([
      prisma.$queryRaw<OverviewRow[]>`
        SELECT
          SUM(oi."priceCents" * oi.quantity) AS total_revenue,
          COUNT(DISTINCT o.id) AS total_orders
        FROM "OrderItem" oi
        JOIN "Listing" l ON l.id = oi."listingId"
        JOIN "Order" o ON o.id = oi."orderId"
        WHERE l."sellerId" = ${sellerId}
          AND o."paidAt" IS NOT NULL
          AND o."sellerRefundId" IS NULL
          AND o."createdAt" >= ${startDate}
          AND o."createdAt" <= ${endDate}
      `,
      prisma.listing.count({ where: { sellerId, status: "ACTIVE" } }),
    ]);

    const totalRevenueCents = Number(overviewRows[0]?.total_revenue ?? 0);
    const totalOrders = Number(overviewRows[0]?.total_orders ?? 0);
    const avgOrderValueCents = totalOrders > 0 ? Math.round(totalRevenueCents / totalOrders) : 0;

    // Engagement: range-aware views/clicks from daily aggregates
    const [rangeViewAgg, listingIds] = await Promise.all([
      prisma.listingViewDaily.aggregate({
        where: { sellerProfileId: sellerId, date: { gte: startDate, lte: endDate } },
        _sum: { views: true, clicks: true },
      }),
      prisma.listing.findMany({ where: { sellerId }, select: { id: true } }).then((ls) => ls.map((l) => l.id)),
    ]);
    const totalViews = rangeViewAgg._sum.views ?? 0;
    const totalClicks = rangeViewAgg._sum.clicks ?? 0;
    // Conversion rate: null when no view data but orders exist (ListingViewDaily tracking wasn't active yet)
    // Cap at 100% to handle edge cases. Returns 0 when both are 0.
    const conversionRate: number | null =
      totalViews === 0
        ? totalOrders === 0 ? 0 : null
        : Math.min((totalOrders / totalViews) * 100, 100);
    // Click-through rate: card clicks divided by listing views. This is not
    // impression-based CTR because Grainline does not store card impressions yet.
    const clickThroughRate: number | null =
      totalViews === 0
        ? totalClicks === 0 ? 0 : null
        : Math.min((totalClicks / totalViews) * 100, 100);

    const [favoritesCount, stockNotificationSubs] = await Promise.all([
      listingIds.length > 0 ? prisma.favorite.count({ where: { listingId: { in: listingIds }, createdAt: { gte: startDate, lte: endDate } } }) : 0,
      listingIds.length > 0 ? prisma.stockNotification.count({ where: { listingId: { in: listingIds }, createdAt: { gte: startDate, lte: endDate } } }) : 0,
    ]);

    // Cart abandonment — range-aware: cart items in range whose listing was not purchased in the same range
    let cartAbandonment = 0;
    if (listingIds.length > 0) {
      const [cartItemsInRange, orderItemsInRange] = await Promise.all([
        prisma.cartItem.findMany({
          where: { listing: { sellerId }, createdAt: { gte: startDate, lte: endDate } },
          select: { listingId: true },
        }),
        prisma.orderItem.findMany({
          where: {
            listing: { sellerId },
            order: { paidAt: { not: null }, sellerRefundId: null, createdAt: { gte: startDate, lte: endDate } },
          },
          select: { listingId: true },
        }),
      ]);
      const purchasedInRange = new Set(orderItemsInRange.map((oi) => oi.listingId));
      cartAbandonment = cartItemsInRange.filter((ci) => !purchasedInRange.has(ci.listingId)).length;
    }

    // Repeat buyer rate (all time)
    type RepeatRow = { buyer_id: string; cnt: bigint };
    const buyerRows = await prisma.$queryRaw<RepeatRow[]>`
      SELECT o."buyerId" AS buyer_id, COUNT(DISTINCT o.id) AS cnt
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      JOIN "Listing" l ON l.id = oi."listingId"
      WHERE l."sellerId" = ${sellerId}
        AND o."paidAt" IS NOT NULL
        AND o."sellerRefundId" IS NULL
      GROUP BY o."buyerId"
    `;
    const totalBuyers = buyerRows.length;
    const repeatBuyers = buyerRows.filter((r) => Number(r.cnt) > 1).length;
    const repeatBuyerRate = totalBuyers > 0 ? (repeatBuyers / totalBuyers) * 100 : 0;

    // Avg processing time in hours
    type ProcessingRow = { avg_hours: number | null };
    const processingRows = await prisma.$queryRaw<ProcessingRow[]>`
      SELECT AVG(EXTRACT(EPOCH FROM (o."shippedAt" - o."createdAt")) / 3600) AS avg_hours
      FROM "Order" o
      JOIN "OrderItem" oi ON oi."orderId" = o.id
      JOIN "Listing" l ON l.id = oi."listingId"
      WHERE l."sellerId" = ${sellerId}
        AND o."shippedAt" IS NOT NULL
        AND o."paidAt" IS NOT NULL
        AND o."sellerRefundId" IS NULL
        AND o."createdAt" >= ${startDate}
        AND o."createdAt" <= ${endDate}
    `;
    const avgProcessingHours: number | null =
      processingRows[0]?.avg_hours != null ? Number(processingRows[0].avg_hours) : null;

    // ── Daily view/click data for chart ────────────────────────────────────────

    const dailyViewData = await prisma.listingViewDaily.findMany({
      where: { sellerProfileId: sellerId, date: { gte: startDate, lte: endDate } },
      select: { date: true, views: true, clicks: true },
    });

    // Build map keyed by YYYY-MM-DD for fast lookup
    const dailyMap = new Map<string, { views: number; clicks: number }>();
    for (const dv of dailyViewData) {
      const key = new Date(dv.date).toISOString().slice(0, 10);
      const existing = dailyMap.get(key) ?? { views: 0, clicks: 0 };
      dailyMap.set(key, { views: existing.views + dv.views, clicks: existing.clicks + dv.clicks });
    }

    // ── Chart data ──────────────────────────────────────────────────────────────

    let chartData: Array<{
      label: string;
      timestamp: string;
      revenue: number;
      orders: number;
      views: number;
      clicks: number;
    }> = [];

    if (chartGrouping === "hour") {
      const dbRows = await prisma.$queryRaw<OrderRowHour[]>`
        SELECT
          EXTRACT(HOUR FROM o."createdAt" AT TIME ZONE 'UTC')::int AS bucket,
          COALESCE(SUM(oi."priceCents" * oi.quantity), 0) AS revenue,
          COUNT(DISTINCT o.id) AS orders
        FROM "Order" o
        JOIN "OrderItem" oi ON oi."orderId" = o.id
        JOIN "Listing" l ON l.id = oi."listingId"
        WHERE l."sellerId" = ${sellerId}
          AND o."paidAt" IS NOT NULL
          AND o."sellerRefundId" IS NULL
          AND o."createdAt" >= ${startDate}
          AND o."createdAt" <= ${endDate}
        GROUP BY bucket
        ORDER BY bucket
      `;
      const byHour = new Map<number, { revenue: number; orders: number }>();
      for (const r of dbRows) {
        byHour.set(Number(r.bucket), { revenue: Number(r.revenue), orders: Number(r.orders) });
      }
      // Distribute daily views/clicks evenly across elapsed hours
      const currentHour = new Date().getUTCHours(); // 0-23
      const isToday = range === "today";
      const hoursElapsed = isToday ? currentHour + 1 : 24;
      const dayKey = startDate.toISOString().slice(0, 10);
      const dayViews = dailyMap.get(dayKey) ?? { views: 0, clicks: 0 };
      const buckets = generateHourBuckets(startDate);
      chartData = buckets.map((b, i) => {
        const ts = new Date(b.timestamp);
        const h = ts.getUTCHours();
        const d = byHour.get(h) ?? { revenue: 0, orders: 0 };
        const views = i < hoursElapsed ? distributeCountEvenly(dayViews.views, hoursElapsed, i) : 0;
        const clicks = i < hoursElapsed ? distributeCountEvenly(dayViews.clicks, hoursElapsed, i) : 0;
        return { ...b, revenue: d.revenue, orders: d.orders, views, clicks };
      });
    } else if (chartGrouping === "day") {
      const dbRows = await prisma.$queryRaw<OrderRowDay[]>`
        SELECT
          DATE_TRUNC('day', o."createdAt" AT TIME ZONE 'UTC') AS bucket,
          COALESCE(SUM(oi."priceCents" * oi.quantity), 0) AS revenue,
          COUNT(DISTINCT o.id) AS orders
        FROM "Order" o
        JOIN "OrderItem" oi ON oi."orderId" = o.id
        JOIN "Listing" l ON l.id = oi."listingId"
        WHERE l."sellerId" = ${sellerId}
          AND o."paidAt" IS NOT NULL
          AND o."sellerRefundId" IS NULL
          AND o."createdAt" >= ${startDate}
          AND o."createdAt" <= ${endDate}
        GROUP BY bucket
        ORDER BY bucket
      `;
      const byDay = new Map<string, { revenue: number; orders: number }>();
      for (const r of dbRows) {
        const key = new Date(r.bucket).toISOString().slice(0, 10);
        byDay.set(key, { revenue: Number(r.revenue), orders: Number(r.orders) });
      }
      // "week" range always shows Mon-Sun; other day ranges show actual date range
      const buckets =
        range === "week" ? generateWeekBuckets(startDate) : generateDayBuckets(startDate, endDate);
      chartData = buckets.map((b) => {
        const key = new Date(b.timestamp).toISOString().slice(0, 10);
        const d = byDay.get(key) ?? { revenue: 0, orders: 0 };
        const vc = dailyMap.get(key) ?? { views: 0, clicks: 0 };
        return { ...b, revenue: d.revenue, orders: d.orders, views: vc.views, clicks: vc.clicks };
      });
    } else if (chartGrouping === "month") {
      const dbRows = await prisma.$queryRaw<OrderRowMonth[]>`
        SELECT
          DATE_TRUNC('month', o."createdAt" AT TIME ZONE 'UTC') AS bucket,
          COALESCE(SUM(oi."priceCents" * oi.quantity), 0) AS revenue,
          COUNT(DISTINCT o.id) AS orders
        FROM "Order" o
        JOIN "OrderItem" oi ON oi."orderId" = o.id
        JOIN "Listing" l ON l.id = oi."listingId"
        WHERE l."sellerId" = ${sellerId}
          AND o."paidAt" IS NOT NULL
          AND o."sellerRefundId" IS NULL
          AND o."createdAt" >= ${startDate}
          AND o."createdAt" <= ${endDate}
        GROUP BY bucket
        ORDER BY bucket
      `;
      const byMonth = new Map<string, { revenue: number; orders: number }>();
      for (const r of dbRows) {
        const key = new Date(r.bucket).toISOString().slice(0, 7); // YYYY-MM
        byMonth.set(key, { revenue: Number(r.revenue), orders: Number(r.orders) });
      }
      // Group daily view data by month (YYYY-MM)
      const monthlyViewMap = new Map<string, { views: number; clicks: number }>();
      for (const [dateKey, vc] of dailyMap) {
        const monthKey = dateKey.slice(0, 7);
        const existing = monthlyViewMap.get(monthKey) ?? { views: 0, clicks: 0 };
        monthlyViewMap.set(monthKey, { views: existing.views + vc.views, clicks: existing.clicks + vc.clicks });
      }
      const buckets = generateMonthBuckets(startDate, endDate);
      chartData = buckets.map((b) => {
        const key = new Date(b.timestamp).toISOString().slice(0, 7);
        const d = byMonth.get(key) ?? { revenue: 0, orders: 0 };
        const vc = monthlyViewMap.get(key) ?? { views: 0, clicks: 0 };
        return { ...b, revenue: d.revenue, orders: d.orders, views: vc.views, clicks: vc.clicks };
      });
    } else {
      // year grouping (alltime)
      const dbRows = await prisma.$queryRaw<OrderRowYear[]>`
        SELECT
          DATE_TRUNC('year', o."createdAt" AT TIME ZONE 'UTC') AS bucket,
          COALESCE(SUM(oi."priceCents" * oi.quantity), 0) AS revenue,
          COUNT(DISTINCT o.id) AS orders
        FROM "Order" o
        JOIN "OrderItem" oi ON oi."orderId" = o.id
        JOIN "Listing" l ON l.id = oi."listingId"
        WHERE l."sellerId" = ${sellerId}
          AND o."paidAt" IS NOT NULL
          AND o."sellerRefundId" IS NULL
          AND o."createdAt" >= ${startDate}
          AND o."createdAt" <= ${endDate}
        GROUP BY bucket
        ORDER BY bucket
      `;
      const byYear = new Map<string, { revenue: number; orders: number }>();
      for (const r of dbRows) {
        const key = new Date(r.bucket).toISOString().slice(0, 4); // YYYY
        byYear.set(key, { revenue: Number(r.revenue), orders: Number(r.orders) });
      }
      // Group daily view data by year (YYYY)
      const yearlyViewMap = new Map<string, { views: number; clicks: number }>();
      for (const [dateKey, vc] of dailyMap) {
        const yearKey = dateKey.slice(0, 4);
        const existing = yearlyViewMap.get(yearKey) ?? { views: 0, clicks: 0 };
        yearlyViewMap.set(yearKey, { views: existing.views + vc.views, clicks: existing.clicks + vc.clicks });
      }
      const buckets = generateYearBuckets(startDate, endDate);
      chartData = buckets.map((b) => {
        const key = new Date(b.timestamp).toISOString().slice(0, 4);
        const d = byYear.get(key) ?? { revenue: 0, orders: 0 };
        const vc = yearlyViewMap.get(key) ?? { views: 0, clicks: 0 };
        return { ...b, revenue: d.revenue, orders: d.orders, views: vc.views, clicks: vc.clicks };
      });
    }

    // ── Top listings (all time) ─────────────────────────────────────────────────

    type TopListingRow = {
      id: string;
      title: string;
      image_url: string | null;
      total_revenue: bigint;
      units_sold: bigint;
      avg_price: bigint;
      view_count: number;
      click_count: number;
      created_at: Date;
    };

    const topListingRows = await prisma.$queryRaw<TopListingRow[]>`
      SELECT
        l.id,
        l.title,
        (SELECT p.url FROM "Photo" p WHERE p."listingId" = l.id ORDER BY p."sortOrder" ASC LIMIT 1) AS image_url,
        COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi."priceCents" * oi.quantity ELSE 0 END), 0) AS total_revenue,
        COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) AS units_sold,
        COALESCE(
          SUM(CASE WHEN o.id IS NOT NULL THEN oi."priceCents" * oi.quantity ELSE 0 END)
          / NULLIF(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0),
          0
        ) AS avg_price,
        l."viewCount" AS view_count,
        l."clickCount" AS click_count,
        l."createdAt" AS created_at
      FROM "Listing" l
      LEFT JOIN "OrderItem" oi ON oi."listingId" = l.id
      LEFT JOIN "Order" o ON o.id = oi."orderId" AND o."paidAt" IS NOT NULL AND o."sellerRefundId" IS NULL
      WHERE l."sellerId" = ${sellerId}
      GROUP BY l.id, l.title, l."viewCount", l."clickCount", l."createdAt"
      ORDER BY total_revenue DESC
      LIMIT 8
    `;

    const topListingIds = topListingRows.map((r) => r.id);
    const [topFavsRows, topStockRows] = await Promise.all([
      topListingIds.length > 0
        ? prisma.favorite.groupBy({
            by: ["listingId"],
            where: { listingId: { in: topListingIds } },
            _count: { _all: true },
          })
        : [],
      topListingIds.length > 0
        ? prisma.stockNotification.groupBy({
            by: ["listingId"],
            where: { listingId: { in: topListingIds } },
            _count: { _all: true },
          })
        : [],
    ]);
    const topFavsMap = new Map(topFavsRows.map((r) => [r.listingId, r._count._all]));
    const topStockMap = new Map(topStockRows.map((r) => [r.listingId, r._count._all]));

    const topListings = topListingRows.map((r) => {
      const daysSinceCreated = Math.max(
        1,
        Math.ceil((Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24)),
      );
      return {
        id: r.id,
        title: r.title,
        imageUrl: r.image_url,
        totalRevenueCents: Number(r.total_revenue),
        unitsSold: Number(r.units_sold),
        avgPriceCents: Number(r.avg_price),
        viewCount: Number(r.view_count),
        clickCount: Number(r.click_count),
        favoritesCount: topFavsMap.get(r.id) ?? 0,
        stockNotificationCount: topStockMap.get(r.id) ?? 0,
        revenuePerActiveDayCents: Math.round(Number(r.total_revenue) / daysSinceCreated),
      };
    });

    // ── Rating over time (monthly) ──────────────────────────────────────────────

    type RatingRow = { bucket: Date; avg_rating: number; review_count: bigint };
    const ratingRows = await prisma.$queryRaw<RatingRow[]>`
      SELECT
        DATE_TRUNC('month', r."createdAt" AT TIME ZONE 'UTC') AS bucket,
        AVG(r."ratingX2") / 2.0 AS avg_rating,
        COUNT(*) AS review_count
      FROM "Review" r
      JOIN "Listing" l ON l.id = r."listingId"
      WHERE l."sellerId" = ${sellerId}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const ratingOverTime = ratingRows.map((r) => ({
      label: new Date(r.bucket).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
      avgRating: Number(r.avg_rating),
      reviewCount: Number(r.review_count),
    }));

    // ── Guild metrics ───────────────────────────────────────────────────────────

    const existingMetrics = await prisma.sellerMetrics.findUnique({
      where: { sellerProfileId: sellerId },
      select: { calculatedAt: true },
    });
    const isStale =
      !existingMetrics ||
      Date.now() - new Date(existingMetrics.calculatedAt).getTime() > 24 * 60 * 60 * 1000;
    const metrics = isStale
      ? await calculateSellerMetrics(sellerId)
      : (await prisma.sellerMetrics.findUnique({ where: { sellerProfileId: sellerId } }))!;

    const guildCriteria = meetsGuildMasterRequirements(metrics);
    const failingKeys = Object.entries(guildCriteria)
      .filter(([k, v]) => k !== "allMet" && !v)
      .map(([k]) => k);

    const humanFailures: Record<string, string> = {
      ratingMet: `Average rating < 4.5 (currently ${metrics.averageRating.toFixed(1)})`,
      reviewsMet: `Reviews < 25 (currently ${metrics.reviewCount})`,
      shippingMet: `On-time shipping < 95% (currently ${(metrics.onTimeShippingRate * 100).toFixed(1)}%)`,
      responseMet: `Response rate < 90% (currently ${(metrics.responseRate * 100).toFixed(1)}%)`,
      ageMet: `Account age < 180 days (currently ${metrics.accountAgeDays} days)`,
      salesMet: `Sales < $1,000 (currently $${(metrics.totalSalesCents / 100).toFixed(0)})`,
      casesMet: `Open cases: ${metrics.activeCaseCount}`,
    };

    return NextResponse.json({
      range,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      chartGrouping,

      overview: {
        totalRevenueCents,
        totalOrders,
        avgOrderValueCents,
        activeListings: activeListingCount,
      },

      engagement: {
        totalViews,
        totalClicks,
        profileVisits: sellerProfile.profileViews,
        conversionRate: conversionRate !== null ? Math.round(conversionRate * 100) / 100 : null,
        clickThroughRate: clickThroughRate !== null ? Math.round(clickThroughRate * 10) / 10 : null,
        cartAbandonment,
        stockNotificationSubs,
        favoritesCount,
      },

      repeatBuyerRate: Math.round(repeatBuyerRate * 10) / 10,
      avgProcessingHours,

      chartData,
      topListings,
      ratingOverTime,

      guildMetrics: {
        averageRating: metrics.averageRating,
        reviewCount: metrics.reviewCount,
        onTimeShippingRate: metrics.onTimeShippingRate,
        responseRate: metrics.responseRate,
        accountAgeDays: metrics.accountAgeDays,
        activeCaseCount: metrics.activeCaseCount,
        totalSalesCents: metrics.totalSalesCents,
        lastCalculatedAt: metrics.calculatedAt?.toISOString() ?? null,
      },
      guildMasterMet: guildCriteria.allMet,
      guildMasterFailures: failingKeys.map((k) => humanFailures[k] ?? k),
    });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("GET /api/seller/analytics error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
