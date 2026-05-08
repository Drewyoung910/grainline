import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { clickRatelimit, clickDedupRatelimit, getIP, safeRateLimitOpen } from "@/lib/ratelimit";
import { hasTrackingCookie, setTrackingCookie } from "@/lib/listingTrackingCookies";
import { publicListingWhere } from "@/lib/listingVisibility";
import { isLikelyBotUserAgent } from "@/lib/botUserAgent";

const CLICKED_LISTING_IDS_COOKIE = "clicked_listing_ids";

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
  if (isLikelyBotUserAgent(userAgent)) return NextResponse.json({ ok: true, skipped: true });

  const ip = getIP(req);
  const { success } = await safeRateLimitOpen(clickRatelimit, ip);
  if (!success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { id } = await params;

  // Per-IP+listing dedup (24h) — silently skip if already counted
  const { success: perClickOk } = await safeRateLimitOpen(clickDedupRatelimit, `${ip}:${id}`);
  if (!perClickOk) return NextResponse.json({ ok: true, skipped: true });
  const cookieStore = await cookies();
  const legacyCookieName = `clicked_${id}`;
  const tracking = hasTrackingCookie(
    cookieStore,
    CLICKED_LISTING_IDS_COOKIE,
    legacyCookieName,
    id
  );

  if (tracking.hasTracked) {
    const res = NextResponse.json({ ok: true, skipped: true });
    if (tracking.hasLegacyCookie) {
      setTrackingCookie(
        res.cookies,
        CLICKED_LISTING_IDS_COOKIE,
        tracking.aggregateIds,
        id,
        legacyCookieName
      );
    }
    return res;
  }

  const tracked = await prisma.$transaction(async (tx) => {
    const updated = await tx.listing.updateMany({
      where: publicListingWhere({ id }),
      data: { clickCount: { increment: 1 } },
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
      create: { listingId: id, sellerProfileId: listing.sellerId, date: today, views: 0, clicks: 1 },
      update: { clicks: { increment: 1 } },
    });
    return true;
  });
  if (!tracked) return NextResponse.json({ ok: true, skipped: true });

  const res = NextResponse.json({ ok: true });
  setTrackingCookie(res.cookies, CLICKED_LISTING_IDS_COOKIE, tracking.aggregateIds, id);
  return res;
}
