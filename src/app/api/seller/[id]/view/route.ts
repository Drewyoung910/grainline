import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getIP, profileViewRatelimit, safeRateLimitOpen, viewRatelimit } from "@/lib/ratelimit";
import { hasTrackingCookie, setTrackingCookie } from "@/lib/listingTrackingCookies";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";

const VIEWED_SELLER_IDS_COOKIE = "viewed_seller_profile_ids";

function isLikelyBot(userAgent: string) {
  return /\b(bot|crawler|spider|preview|facebookexternalhit|slurp|bingpreview|headless)\b/i.test(userAgent);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userAgent = req.headers.get("user-agent") ?? "";
  if (isLikelyBot(userAgent)) return NextResponse.json({ ok: true, skipped: true });

  const ip = getIP(req);
  const { success: globalOk } = await safeRateLimitOpen(viewRatelimit, ip);
  if (!globalOk) return NextResponse.json({ ok: true, skipped: true });

  const { id } = await params;
  const { success: dedupOk } = await safeRateLimitOpen(profileViewRatelimit, `${ip}:seller:${id}`);
  if (!dedupOk) return NextResponse.json({ ok: true, skipped: true });

  const seller = await prisma.sellerProfile.findFirst({
    where: activeSellerProfileWhere({ id }),
    select: { userId: true },
  });
  if (!seller) return NextResponse.json({ ok: true, skipped: true });

  const { userId } = await auth();
  if (userId) {
    const viewer = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    if (viewer?.id === seller.userId) return NextResponse.json({ ok: true, skipped: true });
  }

  const cookieStore = await cookies();
  const legacyCookieName = `viewed_seller_${id}`;
  const tracking = hasTrackingCookie(cookieStore, VIEWED_SELLER_IDS_COOKIE, legacyCookieName, id);

  if (tracking.hasTracked) {
    const res = NextResponse.json({ ok: true, skipped: true });
    if (tracking.hasLegacyCookie) {
      setTrackingCookie(res.cookies, VIEWED_SELLER_IDS_COOKIE, tracking.aggregateIds, id, legacyCookieName);
    }
    return res;
  }

  const result = await prisma.sellerProfile.updateMany({
    where: activeSellerProfileWhere({ id }),
    data: { profileViews: { increment: 1 } },
  });
  if (result.count === 0) return NextResponse.json({ ok: true, skipped: true });

  const res = NextResponse.json({ ok: true });
  setTrackingCookie(res.cookies, VIEWED_SELLER_IDS_COOKIE, tracking.aggregateIds, id, legacyCookieName);
  return res;
}
