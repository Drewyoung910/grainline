import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import {
  claimListingAnalyticsDailyCap,
  clickDedupRatelimit,
  clickRatelimit,
  getIP,
  safeRateLimitOpen,
} from "@/lib/ratelimit";
import { hasTrackingCookie, setTrackingCookie } from "@/lib/listingTrackingCookies";
import { isLikelyBotUserAgent } from "@/lib/botUserAgent";
import { privateResponse } from "@/lib/privateResponse";
import { userIdByClerkId } from "@/lib/userIdentityAccess";
import { recordListingAnalytics } from "@/lib/sellerAnalyticsDailyAccess";

const CLICKED_LISTING_IDS_COOKIE = "clicked_listing_ids";

function telemetryJson(body: Record<string, unknown>) {
  return privateResponse(NextResponse.json(body));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userAgent = req.headers.get("user-agent") ?? "";
  if (isLikelyBotUserAgent(userAgent)) return telemetryJson({ ok: true, skipped: true });

  const ip = getIP(req);
  const { success } = await safeRateLimitOpen(clickRatelimit, ip);
  if (!success) return telemetryJson({ ok: true, skipped: true });

  const { id } = await params;
  const { userId } = await auth();

  // Per-IP+listing dedup (24h) — silently skip if already counted
  const { success: perClickOk } = await safeRateLimitOpen(clickDedupRatelimit, `${ip}:${id}`);
  if (!perClickOk) return telemetryJson({ ok: true, skipped: true });
  const cookieStore = await cookies();
  const legacyCookieName = `clicked_${id}`;
  const tracking = hasTrackingCookie(
    cookieStore,
    CLICKED_LISTING_IDS_COOKIE,
    legacyCookieName,
    id
  );

  if (tracking.hasTracked) {
    const res = telemetryJson({ ok: true, skipped: true });
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

  const dailyCapOk = await claimListingAnalyticsDailyCap("click", id);
  if (!dailyCapOk) return telemetryJson({ ok: true, skipped: true });

  const viewer = userId ? await userIdByClerkId(prisma, userId) : null;
  if (userId && !viewer) return telemetryJson({ ok: true, skipped: true });
  const viewerUserId = viewer?.id ?? null;
  const tracked = await recordListingAnalytics(id, "click", viewerUserId);
  if (!tracked) return telemetryJson({ ok: true, skipped: true });

  const res = telemetryJson({ ok: true });
  setTrackingCookie(res.cookies, CLICKED_LISTING_IDS_COOKIE, tracking.aggregateIds, id);
  return res;
}
