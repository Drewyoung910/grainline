// src/app/api/commission/[id]/interest/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import {
  commissionInterestRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { commissionIsExpired } from "@/lib/commissionExpiry";
import { openCommissionMutationWhere } from "@/lib/commissionState";
import { logSecurityEvent } from "@/lib/security";
import { privateJson, privateResponse } from "@/lib/privateResponse";

const COMMISSION_CLOSED_DURING_INTEREST = "COMMISSION_CLOSED_DURING_INTEREST";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  // Check if already expressed interest
  const existing = await prisma.commissionInterest.findUnique({
    where: {
      commissionRequestId_sellerProfileId: {
        commissionRequestId: id,
        sellerProfileId: sellerProfile.id,
      },
    },
  });
  if (existing) {
    // Return existing conversation if any
    return privateJson({
      conversationId: existing.conversationId,
      alreadyInterested: true,
    });
  }

  // Upsert conversation (canonical sort, race-safe)
  const buyerUserId = commissionRequest.buyerId;
  const [a, b] = [me.id, buyerUserId].sort((x, y) => (x < y ? -1 : 1));
  let conversationId: string | null = null;
  let commissionInterestId: string | null = null;
  const sellerDisplayName = sellerProfile.displayName ?? me.name ?? "A maker";

  try {
    await prisma.$transaction(async (tx) => {
      const openGuard = await tx.commissionRequest.updateMany({
        where: openCommissionMutationWhere(id),
        data: { updatedAt: new Date() },
      });
      if (openGuard.count === 0) {
        throw new Error(COMMISSION_CLOSED_DURING_INTEREST);
      }
      const convo = await tx.conversation.upsert({
        where: { userAId_userBId: { userAId: a, userBId: b } },
        update: { updatedAt: new Date() },
        create: { userAId: a, userBId: b },
        select: { id: true },
      });
      conversationId = convo.id;
      const createdInterest = await tx.commissionInterest.create({
        data: {
          commissionRequestId: id,
          sellerProfileId: sellerProfile.id,
          conversationId: convo.id,
        },
        select: { id: true },
      });
      commissionInterestId = createdInterest.id;
      await tx.message.create({
        data: {
          conversationId: convo.id,
          senderId: me.id,
          recipientId: commissionRequest.buyerId,
          body: JSON.stringify({
            commissionId: id,
            commissionTitle: commissionRequest.title,
            sellerName: sellerDisplayName,
            budgetMinCents: commissionRequest.budgetMinCents,
            budgetMaxCents: commissionRequest.budgetMaxCents,
            timeline: commissionRequest.timeline,
          }),
          kind: "commission_interest_card",
          isSystemMessage: true,
        },
      });
      const interestedCount = await tx.commissionInterest.count({
        where: { commissionRequestId: id },
      });
      await tx.commissionRequest.update({
        where: { id },
        data: { interestedCount },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === COMMISSION_CLOSED_DURING_INTEREST) {
      return privateJson(
        { error: "Commission request is no longer open" },
        { status: 409 },
      );
    }
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      const racedExisting = await prisma.commissionInterest.findUnique({
        where: {
          commissionRequestId_sellerProfileId: {
            commissionRequestId: id,
            sellerProfileId: sellerProfile.id,
          },
        },
        select: { conversationId: true },
      });
      if (racedExisting) {
        return privateJson({
          conversationId: racedExisting.conversationId,
          alreadyInterested: true,
        });
      }
    }
    throw e;
  }
  if (!conversationId || !commissionInterestId)
    return privateJson(
      { error: "Failed to create conversation" },
      { status: 500 },
    );
  const finalConversationId = conversationId;
  const finalCommissionInterestId = commissionInterestId;

  const sellerName = sellerDisplayName;
  after(async () => {
    try {
      await createNotification({
        userId: commissionRequest.buyerId,
        type: "COMMISSION_INTEREST",
        title: `${sellerName} is interested in your commission`,
        body: `"${commissionRequest.title}" — view the conversation`,
        link: `/messages/${finalConversationId}`,
        dedupScope: id,
        relatedUserId: me.id,
        sourceType: NOTIFICATION_SOURCE_TYPES.COMMISSION_INTEREST,
        sourceId: finalCommissionInterestId,
      });
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "commission_interest_side_effects" },
        extra: {
          commissionRequestId: id,
          conversationId: finalConversationId,
          sellerProfileId: sellerProfile.id,
          sellerUserId: me.id,
          buyerId: commissionRequest.buyerId,
        },
      });
    }
  });

  return privateJson({
    conversationId: finalConversationId,
    alreadyInterested: false,
  });
}
