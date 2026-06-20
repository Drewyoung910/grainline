import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { getIP, profileViewRatelimit, safeRateLimitOpen, viewRatelimit } from "@/lib/ratelimit";
import { hasTrackingCookie, setTrackingCookie } from "@/lib/listingTrackingCookies";
import { visibleSellerProfileWhere } from "@/lib/sellerVisibility";
import { isLikelyBotUserAgent } from "@/lib/botUserAgent";
import { privateResponse } from "@/lib/privateResponse";

const VIEWED_SELLER_IDS_COOKIE = "viewed_seller_profile_ids";

function telemetryJson(body: Record<string, unknown>) {
  return privateResponse(NextResponse.json(body));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userAgent = req.headers.get("user-agent") ?? "";
  if (isLikelyBotUserAgent(userAgent)) return telemetryJson({ ok: true, skipped: true });

  const ip = getIP(req);
  const { success: globalOk } = await safeRateLimitOpen(viewRatelimit, ip);
  if (!globalOk) return telemetryJson({ ok: true, skipped: true });

  const { id } = await params;
  const { success: dedupOk } = await safeRateLimitOpen(profileViewRatelimit, `${ip}:seller:${id}`);
  if (!dedupOk) return telemetryJson({ ok: true, skipped: true });

  const seller = await prisma.sellerProfile.findFirst({
    where: visibleSellerProfileWhere({ id }),
    select: { userId: true },
  });
  if (!seller) return telemetryJson({ ok: true, skipped: true });

  const { userId } = await auth();
  if (userId) {
    const viewer = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    if (viewer?.id === seller.userId) return telemetryJson({ ok: true, skipped: true });
  }

  const cookieStore = await cookies();
  const legacyCookieName = `viewed_seller_${id}`;
  const tracking = hasTrackingCookie(cookieStore, VIEWED_SELLER_IDS_COOKIE, legacyCookieName, id);

  if (tracking.hasTracked) {
    const res = telemetryJson({ ok: true, skipped: true });
    if (tracking.hasLegacyCookie) {
      setTrackingCookie(res.cookies, VIEWED_SELLER_IDS_COOKIE, tracking.aggregateIds, id, legacyCookieName);
    }
    return res;
  }

  const result = await prisma.sellerProfile.updateMany({
    where: visibleSellerProfileWhere({ id }),
    data: { profileViews: { increment: 1 } },
  });
  if (result.count === 0) return telemetryJson({ ok: true, skipped: true });

  const res = telemetryJson({ ok: true });
  setTrackingCookie(res.cookies, VIEWED_SELLER_IDS_COOKIE, tracking.aggregateIds, id, legacyCookieName);
  return res;
}
