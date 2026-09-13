import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  claimListingAnalyticsDailyCap,
  getIP,
  profileViewRatelimit,
  safeRateLimitOpen,
  viewRatelimit,
} from "@/lib/ratelimit";
import { hasTrackingCookie, setTrackingCookie } from "@/lib/listingTrackingCookies";
import { publicListingWhere } from "@/lib/listingVisibility";
import { isLikelyBotUserAgent } from "@/lib/botUserAgent";
import { privateResponse } from "@/lib/privateResponse";

const VIEWED_LISTING_IDS_COOKIE = "viewed_listing_ids";

function telemetryJson(body: Record<string, unknown>) {
  return privateResponse(NextResponse.json(body));
}

function todayUtcBucket() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userAgent = req.headers.get("user-agent") ?? "";
  if (isLikelyBotUserAgent(userAgent)) return telemetryJson({ ok: true, skipped: true });

  const ip = getIP(req);
  const { success: globalOk } = await safeRateLimitOpen(viewRatelimit, ip);
  if (!globalOk) return telemetryJson({ ok: true }); // silent drop

  const { id } = await params;
  const { userId } = await auth();

  // Per-IP+listing dedup (24h) — silently skip if already counted
  const { success: dedupOk } = await safeRateLimitOpen(profileViewRatelimit, `${ip}:${id}`);
  if (!dedupOk) return telemetryJson({ ok: true, skipped: true });

  const cookieStore = await cookies();
  const legacyCookieName = `viewed_${id}`;
  const tracking = hasTrackingCookie(
    cookieStore,
    VIEWED_LISTING_IDS_COOKIE,
    legacyCookieName,
    id
  );

  if (tracking.hasTracked) {
    const res = telemetryJson({ ok: true, skipped: true });
    if (tracking.hasLegacyCookie) {
      setTrackingCookie(
        res.cookies,
        VIEWED_LISTING_IDS_COOKIE,
        tracking.aggregateIds,
        id,
        legacyCookieName
      );
    }
    return res;
  }

  const dailyCapOk = await claimListingAnalyticsDailyCap("view", id);
  if (!dailyCapOk) return telemetryJson({ ok: true, skipped: true });

  const tracked = await prisma.$transaction(async (tx) => {
    const updated = await tx.listing.updateMany({
      where: publicListingWhere({
        id,
        ...(userId ? { seller: { user: { clerkId: { not: userId } } } } : {}),
      }),
      data: { viewCount: { increment: 1 } },
    });
    if (updated.count === 0) return false;

    const listing = await tx.listing.findUnique({
      where: { id },
      select: { sellerId: true },
    });
    if (!listing) return false;

    const today = todayUtcBucket();
    await tx.listingViewDaily.upsert({
      where: { listingId_date: { listingId: id, date: today } },
      create: { listingId: id, sellerProfileId: listing.sellerId, date: today, views: 1, clicks: 0 },
      update: { views: { increment: 1 } },
    });
    return true;
  });
  if (!tracked) return telemetryJson({ ok: true, skipped: true });

  const res = telemetryJson({ ok: true });
  setTrackingCookie(res.cookies, VIEWED_LISTING_IDS_COOKIE, tracking.aggregateIds, id);
  return res;
}
