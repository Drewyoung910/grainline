// src/app/api/follow/[sellerId]/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import {
  ensureUser,
  ensureUserByClerkId,
  isAccountAccessError,
} from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import {
  followRatelimit,
  getIP,
  rateLimitResponse,
  safeRateLimit,
  searchRatelimit,
} from "@/lib/ratelimit";
import { logSecurityEvent } from "@/lib/security";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { logServerError } from "@/lib/serverErrorLogger";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import {
  createSellerFollow,
  deleteSellerFollow,
  sellerPublicFollowState,
} from "@/lib/sellerFollowAccess";

// GET — check if current user follows this seller
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;

  const { success, reset } = await safeRateLimit(searchRatelimit, getIP(req));
  if (!success)
    return privateResponse(rateLimitResponse(reset, "Too many follow reads."));

  // sellerId here is the SellerProfile.id (not userId).
  const publicState = await sellerPublicFollowState(sellerId);
  if (!publicState)
    return privateJson({ error: "Not found" }, { status: 404 });

  const { userId } = await auth();
  if (!userId) {
    return privateJson({
      following: false,
      followerCount: publicState.followerCount,
    });
  }

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const state = await sellerPublicFollowState(sellerId, me.id);
  if (!state) return privateJson({ error: "Not found" }, { status: 404 });
  return privateJson({
    following: state.following,
    followerCount: state.followerCount,
  });
}

// POST — follow
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { sellerId } = await params;

  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(followRatelimit, userId);
  if (!rlOk)
    return privateResponse(
      rateLimitResponse(reset, "Too many follow actions."),
    );

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (err) {
    if (isAccountAccessError(err))
      return privateJson(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    throw err;
  }
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const result = await createSellerFollow(me.id, sellerId);
  if (result.status !== "OK") {
    if (result.status === "NOT_FOUND") {
      return privateJson({ error: "Not found" }, { status: 404 });
    }
    if (result.status === "SELF") {
      logSecurityEvent("spam_attempt", {
        userId: me.id,
        route: "/api/follow",
        reason: "self-follow attempt",
      });
      return privateJson({ error: "Cannot follow yourself" }, { status: 400 });
    }
    return privateJson({ error: "Blocked" }, { status: 403 });
  }

  // Only notify the seller on a new follow; createNotification handles exact duplicate suppression.
  if (result.created) {
    const followerName = me.name ?? "Someone";
    try {
      await createNotification({
        userId: result.ownerUserId,
        type: "NEW_FOLLOWER",
        title: `${followerName} started following you`,
        body: "They can now see your new listings and posts in their feed",
        link: "/dashboard/analytics",
        dedupScope: me.id,
        relatedUserId: me.id,
        sourceType: NOTIFICATION_SOURCE_TYPES.FOLLOW,
        sourceId: sellerId,
      });
    } catch (error) {
      logServerError(error, {
        source: "follow_notification",
        level: "warning",
        extra: {
          followerId: me.id,
          sellerProfileId: sellerId,
          sellerUserId: result.ownerUserId,
        },
      });
    }
  }

  return privateJson({ following: true, followerCount: result.followerCount });
}

// DELETE — unfollow
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { sellerId } = await params;

  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(followRatelimit, userId);
  if (!rlOk)
    return privateResponse(
      rateLimitResponse(reset, "Too many follow actions."),
    );

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err))
      return privateJson(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    throw err;
  }

  const result = await deleteSellerFollow(me.id, sellerId);
  if (result.status === "NOT_FOUND")
    return privateJson({ error: "Not found" }, { status: 404 });
  return privateJson({ following: false, followerCount: result.followerCount });
}
