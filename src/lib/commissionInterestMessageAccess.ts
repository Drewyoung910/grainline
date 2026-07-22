import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { openCommissionMutationWhere } from "@/lib/commissionState";
import {
  getOrCreateConversationForLockedPair,
  lockConversationParticipantPair,
} from "@/lib/conversationStartAccess";

type CommissionInterestMessageResult =
  | {
      ok: true;
      alreadyInterested: true;
      conversationId: string;
      commissionInterestId: null;
      buyerUserId: string;
      commissionTitle: string;
      sellerDisplayName: string;
    }
  | {
      ok: true;
      alreadyInterested: false;
      conversationId: string;
      commissionInterestId: string;
      buyerUserId: string;
      commissionTitle: string;
      sellerDisplayName: string;
    }
  | { ok: false; error: "closed" | "unavailable" | "seller_state" };

/**
 * Co-commits commission interest, its canonical Conversation, and its opening
 * Message after revalidating every relationship at the write boundary.
 */
export async function createCommissionInterestMessage(input: {
  commissionRequestId: string;
  sellerUserId: string;
  sellerProfileId: string;
}): Promise<CommissionInterestMessageResult> {
  return prisma.$transaction(async (tx) => {
    const initialCommission = await tx.commissionRequest.findUnique({
      where: { id: input.commissionRequestId },
      select: { buyerId: true },
    });
    if (!initialCommission) return { ok: false as const, error: "closed" as const };

    const pair = await lockConversationParticipantPair(
      tx,
      input.sellerUserId,
      initialCommission.buyerId,
    );
    if (!pair.ok) return { ok: false as const, error: "unavailable" as const };

    const sellers = await tx.$queryRaw<Array<{
      id: string;
      displayName: string | null;
      userName: string | null;
    }>>`
      SELECT
        seller.id,
        seller."displayName",
        seller_user.name AS "userName"
      FROM "SellerProfile" AS seller
      JOIN "User" AS seller_user
        ON seller_user.id = seller."userId"
      WHERE seller.id = ${input.sellerProfileId}
        AND seller."userId" = ${input.sellerUserId}
        AND seller."chargesEnabled" = true
        AND seller."vacationMode" = false
      FOR SHARE OF seller
    `;
    const seller = sellers[0];
    if (sellers.length !== 1) {
      return { ok: false as const, error: "seller_state" as const };
    }

    const openGuard = await tx.commissionRequest.updateMany({
      where: openCommissionMutationWhere(input.commissionRequestId, new Date(), {
        buyerId: initialCommission.buyerId,
      }),
      data: { updatedAt: new Date() },
    });
    if (openGuard.count === 0) {
      return { ok: false as const, error: "closed" as const };
    }

    const commission = await tx.commissionRequest.findUnique({
      where: { id: input.commissionRequestId },
      select: {
        buyerId: true,
        title: true,
        budgetMinCents: true,
        budgetMaxCents: true,
        timeline: true,
      },
    });
    if (!commission || commission.buyerId !== initialCommission.buyerId) {
      return { ok: false as const, error: "closed" as const };
    }

    const existing = await tx.commissionInterest.findUnique({
      where: {
        commissionRequestId_sellerProfileId: {
          commissionRequestId: input.commissionRequestId,
          sellerProfileId: input.sellerProfileId,
        },
      },
      select: { id: true, conversationId: true },
    });
    const sellerDisplayName = seller.displayName ?? seller.userName ?? "A maker";
    if (existing?.conversationId) {
      return {
        ok: true as const,
        alreadyInterested: true,
        conversationId: existing.conversationId,
        commissionInterestId: null,
        buyerUserId: commission.buyerId,
        commissionTitle: commission.title,
        sellerDisplayName,
      };
    }

    const conversation = await getOrCreateConversationForLockedPair(tx, pair, null);
    const interest = existing
      ? await tx.commissionInterest.update({
          where: { id: existing.id },
          data: { conversationId: conversation.conversationId },
          select: { id: true },
        })
      : await tx.commissionInterest.create({
          data: {
            commissionRequestId: input.commissionRequestId,
            sellerProfileId: input.sellerProfileId,
            conversationId: conversation.conversationId,
          },
          select: { id: true },
        });
    await tx.message.create({
      data: {
        conversationId: conversation.conversationId,
        senderId: input.sellerUserId,
        recipientId: commission.buyerId,
        body: JSON.stringify({
          commissionId: input.commissionRequestId,
          commissionTitle: commission.title,
          sellerName: sellerDisplayName,
          budgetMinCents: commission.budgetMinCents,
          budgetMaxCents: commission.budgetMaxCents,
          timeline: commission.timeline,
        }),
        kind: "commission_interest_card",
        isSystemMessage: true,
      },
    });
    const interestedCount = await tx.commissionInterest.count({
      where: { commissionRequestId: input.commissionRequestId },
    });
    await tx.commissionRequest.update({
      where: { id: input.commissionRequestId },
      data: { interestedCount },
    });

    const common = {
      ok: true as const,
      conversationId: conversation.conversationId,
      buyerUserId: commission.buyerId,
      commissionTitle: commission.title,
      sellerDisplayName,
    };
    return existing
      ? { ...common, alreadyInterested: true as const, commissionInterestId: null }
      : { ...common, alreadyInterested: false as const, commissionInterestId: interest.id };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}
