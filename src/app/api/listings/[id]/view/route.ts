import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { viewRatelimit, profileViewRatelimit, getIP, safeRateLimitOpen } from "@/lib/ratelimit";
import { hasTrackingCookie, setTrackingCookie } from "@/lib/listingTrackingCookies";

const VIEWED_LISTING_IDS_COOKIE = "viewed_listing_ids";

function todayUtcBucket() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getIP(req);
  const { success: globalOk } = await safeRateLimitOpen(viewRatelimit, ip);
  if (!globalOk) return NextResponse.json({ ok: true }); // silent drop

  const { id } = await params;

  // Per-IP+listing dedup (24h) — silently skip if already counted
  const { success: dedupOk } = await safeRateLimitOpen(profileViewRatelimit, `${ip}:${id}`);
  if (!dedupOk) return NextResponse.json({ ok: true, skipped: true });

  const cookieStore = await cookies();
  const legacyCookieName = `viewed_${id}`;
  const tracking = hasTrackingCookie(
    cookieStore,
    VIEWED_LISTING_IDS_COOKIE,
    legacyCookieName,
    id
  );

  if (tracking.hasTracked) {
    const res = NextResponse.json({ ok: true, skipped: true });
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

  await prisma.$transaction(async (tx) => {
    const listing = await tx.listing.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
      select: { sellerId: true },
    });
    const today = todayUtcBucket();
    await tx.listingViewDaily.upsert({
      where: { listingId_date: { listingId: id, date: today } },
      create: { listingId: id, sellerProfileId: listing.sellerId, date: today, views: 1, clicks: 0 },
      update: { views: { increment: 1 } },
    });
  }).catch((error) => {
    if ((error as { code?: string }).code !== "P2025") throw error;
  });

  const res = NextResponse.json({ ok: true });
  setTrackingCookie(res.cookies, VIEWED_LISTING_IDS_COOKIE, tracking.aggregateIds, id);
  return res;
}
