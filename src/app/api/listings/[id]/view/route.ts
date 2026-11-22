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
import { incrementPublicListingAnalytics } from "@/lib/listingAnalyticsAccess";
import { isLikelyBotUserAgent } from "@/lib/botUserAgent";
import { privateResponse } from "@/lib/privateResponse";
import { userIdByClerkId } from "@/lib/userIdentityAccess";

const VIEWED_LISTING_IDS_COOKIE = "viewed_listing_ids";

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

  const viewer = userId ? await userIdByClerkId(prisma, userId) : null;
  if (userId && !viewer) return telemetryJson({ ok: true, skipped: true });
  const viewerUserId = viewer?.id ?? null;
  const tracked = await incrementPublicListingAnalytics({
    listingId: id,
    eventKind: "view",
    viewerUserId,
  });
  if (!tracked) return telemetryJson({ ok: true, skipped: true });

  const res = telemetryJson({ ok: true });
  setTrackingCookie(res.cookies, VIEWED_LISTING_IDS_COOKIE, tracking.aggregateIds, id);
  return res;
}
