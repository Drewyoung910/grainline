// src/app/api/follow/[sellerId]/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
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
import { visibleSellerProfileWhere } from "@/lib/sellerVisibility";
import { privateJson, privateResponse } from "@/lib/privateResponse";

async function getFollowerCount(sellerProfileId: string) {
  return prisma.follow.count({ where: { sellerProfileId } });
}

// GET — check if current user follows this seller
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
  const { sellerId } = await params;

  const { success, reset } = await safeRateLimit(searchRatelimit, getIP(req));
  if (!success)
    return privateResponse(rateLimitResponse(reset, "Too many follow reads."));

  // sellerId here is the SellerProfile.id (not userId)
  const sellerProfile = await prisma.sellerProfile.findFirst({
    where: visibleSellerProfileWhere({ id: sellerId }),
    select: { id: true },
  });
  if (!sellerProfile)
    return privateJson({ error: "Not found" }, { status: 404 });

  const followerCount = await getFollowerCount(sellerProfile.id);

  const { userId } = await auth();
  if (!userId) {
    return privateJson({ following: false, followerCount });
  }

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const existing = await prisma.follow.findUnique({
    where: {
      followerId_sellerProfileId: {
        followerId: me.id,
        sellerProfileId: sellerProfile.id,
      },
    },
    select: { id: true },
  });

  return privateJson({ following: !!existing, followerCount });
}

// POST — follow
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
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

  const sellerProfile = await prisma.sellerProfile.findFirst({
    where: visibleSellerProfileWhere({ id: sellerId }),
    select: { id: true, userId: true, displayName: true },
  });
  if (!sellerProfile)
    return privateJson({ error: "Not found" }, { status: 404 });

  // Cannot follow yourself
  if (sellerProfile.userId === me.id) {
    logSecurityEvent("spam_attempt", {
      userId: me.id,
      route: "/api/follow",
      reason: "self-follow attempt",
    });
    return privateJson({ error: "Cannot follow yourself" }, { status: 400 });
  }

  // Don't allow following a user who has blocked you or whom you've blocked
  const blockExists = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: sellerProfile.userId },
        { blockerId: sellerProfile.userId, blockedId: me.id },
      ],
    },
    select: { id: true },
  });
  if (blockExists) return privateJson({ error: "Blocked" }, { status: 403 });

  // Check if already following before upsert so we only notify on new follows
  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerId_sellerProfileId: {
        followerId: me.id,
        sellerProfileId: sellerProfile.id,
      },
    },
    select: { id: true },
  });

  await prisma.follow.upsert({
    where: {
      followerId_sellerProfileId: {
        followerId: me.id,
        sellerProfileId: sellerProfile.id,
      },
    },
    create: { followerId: me.id, sellerProfileId: sellerProfile.id },
    update: {},
  });

  const blockAfterFollow = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: sellerProfile.userId },
        { blockerId: sellerProfile.userId, blockedId: me.id },
      ],
    },
    select: { id: true },
  });
  if (blockAfterFollow) {
    await prisma.follow.deleteMany({
      where: { followerId: me.id, sellerProfileId: sellerProfile.id },
    });
    return privateJson({ error: "Blocked" }, { status: 403 });
  }

  const followerCount = await getFollowerCount(sellerProfile.id);

  // Only notify the seller on a new follow; createNotification handles exact duplicate suppression.
  if (!existingFollow) {
    const followerName = me.name ?? "Someone";
    try {
      await createNotification({
        userId: sellerProfile.userId,
        type: "NEW_FOLLOWER",
        title: `${followerName} started following you`,
        body: "They can now see your new listings and posts in their feed",
        link: "/dashboard/analytics",
        dedupScope: me.id,
      });
    } catch (error) {
      console.error("Failed to create follow notification:", error);
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "follow_notification" },
        extra: {
          followerId: me.id,
          sellerProfileId: sellerProfile.id,
          sellerUserId: sellerProfile.userId,
        },
      });
    }
  }

  return privateJson({ following: true, followerCount });
}

// DELETE — unfollow
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> },
) {
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

  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { id: true },
  });
  if (!sellerProfile)
    return privateJson({ error: "Not found" }, { status: 404 });

  await prisma.follow.deleteMany({
    where: { followerId: me.id, sellerProfileId: sellerProfile.id },
  });

  const followerCount = await getFollowerCount(sellerProfile.id);

  return privateJson({ following: false, followerCount });
}
