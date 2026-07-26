import { Prisma } from "@prisma/client";
import {
  createActorCommissionInterest,
} from "@/lib/conversationMessageAuthority";

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
  | { ok: false; error: "unavailable" };

/**
 * Co-commits commission interest, its canonical Conversation, and its opening
 * Message after revalidating every relationship at the write boundary.
 */
export async function createCommissionInterestMessage(input: {
  commissionRequestId: string;
  sellerUserId: string;
}): Promise<CommissionInterestMessageResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const interest = await createActorCommissionInterest(input);
      const common = {
        ok: true as const,
        conversationId: interest.conversationId,
        buyerUserId: interest.buyerUserId,
        commissionTitle: interest.commissionTitle,
        sellerDisplayName: interest.sellerDisplayName,
      };
      return interest.created
        ? {
            ...common,
            alreadyInterested: false,
            commissionInterestId: interest.commissionInterestId,
          }
        : {
            ...common,
            alreadyInterested: true,
            commissionInterestId: null,
          };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2010"
      ) {
        const sqlState = error.meta?.code;
        if (sqlState === "40001" && attempt === 0) continue;
        if (sqlState === "22023" || sqlState === "42501") {
          // Friendly route prechecks handle the common cases. The authority
          // boundary deliberately collapses close/block/account races instead
          // of exposing which relationship changed.
          return { ok: false, error: "unavailable" };
        }
      }
      throw error;
    }
  }
  throw new Error("commission-interest authority retry exhausted");
}
