// src/app/api/commission/[id]/interest/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import {
  commissionInterestRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { commissionIsExpired } from "@/lib/commissionExpiry";
import { logSecurityEvent } from "@/lib/security";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { createCommissionInterestMessage } from "@/lib/commissionInterestMessageAccess";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(
    commissionInterestRatelimit,
    userId,
  );
  if (!rlOk)
    return privateResponse(
      rateLimitResponse(reset, "Too many interest expressions today."),
    );

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: {
      id: true,
      name: true,
      banned: true,
      deletedAt: true,
      sellerProfile: {
        select: {
          id: true,
          displayName: true,
          avatarImageUrl: true,
          chargesEnabled: true,
          vacationMode: true,
        },
      },
    },
  });
  if (!me) return privateJson({ error: "User not found" }, { status: 401 });
  if (me.banned || me.deletedAt)
    return privateJson({ error: "Account is suspended" }, { status: 403 });
  const sellerProfile = me.sellerProfile;
  if (!sellerProfile)
    return privateJson({ error: "Seller profile required" }, { status: 403 });
  if (!sellerProfile.chargesEnabled) {
    return privateJson(
      { error: "Connect Stripe before expressing interest." },
      { status: 403 },
    );
  }
  if (sellerProfile.vacationMode) {
    return privateJson(
      { error: "Turn off vacation mode before expressing interest." },
      { status: 403 },
    );
  }

  const commissionRequest = await prisma.commissionRequest.findUnique({
    where: { id },
    select: {
      id: true,
      buyerId: true,
      title: true,
      description: true,
      status: true,
      expiresAt: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      timeline: true,
      buyer: {
        select: { id: true, name: true, banned: true, deletedAt: true },
      },
    },
  });
  if (!commissionRequest)
    return privateJson({ error: "Not found" }, { status: 404 });
  if (commissionRequest.buyer.banned || commissionRequest.buyer.deletedAt) {
    return privateJson({ error: "Not found" }, { status: 404 });
  }
  if (
    commissionRequest.status !== "OPEN" ||
    commissionIsExpired(commissionRequest)
  ) {
    return privateJson(
      { error: "Commission request is no longer open" },
      { status: 400 },
    );
  }
  if (commissionRequest.buyerId === me.id) {
    logSecurityEvent("spam_attempt", {
      userId: me.id,
      route: "/api/commission/interest",
      reason: "interest on own commission",
    });
    return privateJson(
      { error: "Cannot express interest in your own request" },
      { status: 400 },
    );
  }

  const blockExists = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: commissionRequest.buyerId },
        { blockerId: commissionRequest.buyerId, blockedId: me.id },
      ],
    },
    select: { id: true },
  });
  if (blockExists) {
    return privateJson(
      { error: "Unable to express interest." },
      { status: 403 },
    );
  }

  const result = await createCommissionInterestMessage({
    commissionRequestId: id,
    sellerUserId: me.id,
    sellerProfileId: sellerProfile.id,
  });
  if (!result.ok) {
    if (result.error === "closed") {
      return privateJson(
        { error: "Commission request is no longer open" },
        { status: 409 },
      );
    }
    return privateJson(
      { error: "Unable to express interest." },
      { status: 403 },
    );
  }
  if (result.alreadyInterested) {
    return privateJson({
      conversationId: result.conversationId,
      alreadyInterested: true,
    });
  }
  if (!result.commissionInterestId) {
    throw new Error("Created commission interest is missing its durable id");
  }

  after(async () => {
    try {
      await createNotification({
        userId: result.buyerUserId,
        type: "COMMISSION_INTEREST",
        title: `${result.sellerDisplayName} is interested in your commission`,
        body: `"${result.commissionTitle}" — view the conversation`,
        link: `/messages/${result.conversationId}`,
        dedupScope: id,
        relatedUserId: me.id,
        sourceType: NOTIFICATION_SOURCE_TYPES.COMMISSION_INTEREST,
        sourceId: result.commissionInterestId,
      });
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "commission_interest_side_effects" },
        extra: {
          commissionRequestId: id,
          conversationId: result.conversationId,
          sellerProfileId: sellerProfile.id,
          sellerUserId: me.id,
          buyerId: result.buyerUserId,
        },
      });
    }
  });

  return privateJson({
    conversationId: result.conversationId,
    alreadyInterested: false,
  });
}
