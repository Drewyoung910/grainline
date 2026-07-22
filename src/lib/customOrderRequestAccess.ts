import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  getOrCreateConversationForLockedPair,
  lockConversationParticipantPair,
} from "@/lib/conversationStartAccess";

const TIMELINE_LABELS: Record<string, string> = {
  no_rush: "No rush (2+ months)",
  "2_months": "Within 2 months",
  "1_month": "Within 1 month",
  "2_weeks": "Within 2 weeks",
};

type CreateCustomOrderRequestInput = {
  buyerUserId: string;
  sellerUserId: string;
  description: string;
  dimensions: string | null;
  budgetCents: number | null;
  timeline: string | null;
  listingId: string | null;
};

type CreateCustomOrderRequestResult =
  | {
      ok: true;
      conversationId: string;
      messageId: string;
      listingId: string | null;
      listingTitle: string | null;
    }
  | { ok: false; error: "unavailable" | "blocked" | "seller_state" | "listing" };

export async function createCustomOrderRequestMessage(
  input: CreateCustomOrderRequestInput,
): Promise<CreateCustomOrderRequestResult> {
  return prisma.$transaction(async (tx) => {
    const pair = await lockConversationParticipantPair(
      tx,
      input.buyerUserId,
      input.sellerUserId,
    );
    if (!pair.ok) {
      return {
        ok: false as const,
        error: pair.error === "blocked" ? "blocked" as const : "unavailable" as const,
      };
    }

    const sellerRows = await tx.$queryRaw<Array<{
      id: string;
      acceptsCustomOrders: boolean;
      acceptingNewOrders: boolean;
      stripeAccountId: string | null;
      stripeAccountVersion: string | null;
      chargesEnabled: boolean;
      vacationMode: boolean;
    }>>`
      SELECT
        seller.id,
        seller."acceptsCustomOrders",
        seller."acceptingNewOrders",
        seller."stripeAccountId",
        seller."stripeAccountVersion",
        seller."chargesEnabled",
        seller."vacationMode"
      FROM "SellerProfile" AS seller
      WHERE seller."userId" = ${input.sellerUserId}
      FOR SHARE
    `;
    const seller = sellerRows[0];
    if (
      sellerRows.length !== 1
      || !seller.acceptsCustomOrders
      || !seller.acceptingNewOrders
      || !seller.stripeAccountId
      || !seller.chargesEnabled
      || seller.vacationMode
      || (seller.stripeAccountVersion !== null && seller.stripeAccountVersion !== "v2")
    ) {
      return { ok: false as const, error: "seller_state" as const };
    }

    let listingId: string | null = null;
    let listingTitle: string | null = null;
    if (input.listingId) {
      const listingRows = await tx.$queryRaw<Array<{ id: string; title: string }>>`
        SELECT listing.id, listing.title::text AS title
        FROM "Listing" AS listing
        WHERE listing.id = ${input.listingId}
          AND listing."sellerId" = ${seller.id}
          AND listing.status = 'ACTIVE'
          AND listing."isPrivate" = false
        FOR SHARE
      `;
      if (listingRows.length !== 1) {
        return { ok: false as const, error: "listing" as const };
      }
      listingId = listingRows[0].id;
      listingTitle = listingRows[0].title;
    }

    if (
      !input.description
      || input.description.length > 500
      || (input.dimensions !== null && input.dimensions.length > 200)
      || (input.timeline !== null && input.timeline.length > 50)
      || (input.budgetCents !== null
        && (!Number.isSafeInteger(input.budgetCents)
          || input.budgetCents <= 0
          || input.budgetCents > 10_000_000))
    ) {
      return { ok: false as const, error: "unavailable" as const };
    }

    const conversation = await getOrCreateConversationForLockedPair(
      tx,
      pair,
      listingId,
    );
    const messageBody = JSON.stringify({
      description: input.description,
      dimensions: input.dimensions,
      budget: input.budgetCents !== null ? input.budgetCents / 100 : null,
      timeline: input.timeline,
      timelineLabel: input.timeline ? (TIMELINE_LABELS[input.timeline] ?? input.timeline) : null,
      listingId,
      listingTitle,
    });
    const requestMessage = await tx.message.create({
      data: {
        conversationId: conversation.conversationId,
        senderId: input.buyerUserId,
        recipientId: input.sellerUserId,
        contextListingId: listingId,
        body: messageBody,
        kind: "custom_order_request",
      },
      select: { id: true },
    });
    await tx.conversation.update({
      where: { id: conversation.conversationId },
      data: { updatedAt: new Date(), archivedAAt: null, archivedBAt: null },
    });

    return {
      ok: true as const,
      conversationId: conversation.conversationId,
      messageId: requestMessage.id,
      listingId,
      listingTitle,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}
