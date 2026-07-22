import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const CONVERSATION_START_LOCK_NAMESPACE = 913350;

export type LockedConversationParticipantPair = {
  ok: true;
  userAId: string;
  userBId: string;
};

type ConversationPairFailure = {
  ok: false;
  error: "invalid_participants" | "unavailable" | "blocked";
};

type ConversationStartResult =
  | { ok: true; conversationId: string; created: boolean }
  | ConversationPairFailure;

export type LockedConversationContextListing = {
  id: string;
  title: string;
};

/**
 * Locks and validates a listing before it becomes message/conversation
 * context. The caller supplies only the durable listing id; seller identity,
 * private reservation, publication, and account state all come from the
 * database and must match the already-locked participant pair.
 */
export async function lockConversationContextListingForPair(
  tx: Prisma.TransactionClient,
  pair: LockedConversationParticipantPair,
  requestedListingId: string,
): Promise<LockedConversationContextListing | null> {
  if (!requestedListingId || requestedListingId.length > 191) return null;

  const rows = await tx.$queryRaw<LockedConversationContextListing[]>`
    SELECT listing.id, listing.title::text AS title
      FROM "Listing" AS listing
      JOIN "SellerProfile" AS seller
        ON seller.id = listing."sellerId"
      JOIN "User" AS seller_user
        ON seller_user.id = seller."userId"
     WHERE listing.id = ${requestedListingId}
       AND listing.status = 'ACTIVE'
       AND seller."userId" IN (${pair.userAId}, ${pair.userBId})
       AND seller."chargesEnabled" = true
       AND (seller."stripeAccountVersion" IS NULL OR seller."stripeAccountVersion" = 'v2')
       AND seller."vacationMode" = false
       AND seller_user.banned = false
       AND seller_user."deletedAt" IS NULL
       AND (
         listing."isPrivate" = false
         OR (
           listing."reservedForUserId" IN (${pair.userAId}, ${pair.userBId})
           AND listing."reservedForUserId" <> seller."userId"
         )
       )
     FOR SHARE OF listing, seller, seller_user
  `;
  return rows.length === 1 ? rows[0] : null;
}

export async function lockConversationParticipantPair(
  tx: Prisma.TransactionClient,
  userId: string,
  otherUserId: string,
): Promise<LockedConversationParticipantPair | ConversationPairFailure> {
  if (!userId || !otherUserId || userId === otherUserId) {
    return { ok: false, error: "invalid_participants" };
  }

  const [userAId, userBId] = [userId, otherUserId].sort((left, right) => (
    left < right ? -1 : 1
  ));

  // Block/unblock takes FOR UPDATE on this same sorted pair. The compatible
  // FOR SHARE lock makes whichever operation locks first the explicit
  // create-vs-block linearization point and also conflicts with account
  // deletion's User update.
  const users = await tx.$queryRaw<Array<{
    id: string;
    banned: boolean;
    deletedAt: Date | null;
  }>>`
    SELECT start_user.id, start_user.banned, start_user."deletedAt"
      FROM "User" AS start_user
     WHERE start_user.id IN (${userAId}, ${userBId})
     ORDER BY start_user.id
     FOR SHARE
  `;
  if (users.length !== 2 || users.some((user) => user.banned || user.deletedAt !== null)) {
    return { ok: false, error: "unavailable" };
  }

  const block = await tx.block.findFirst({
    where: {
      OR: [
        { blockerId: userAId, blockedId: userBId },
        { blockerId: userBId, blockedId: userAId },
      ],
    },
    select: { id: true },
  });
  if (block) return { ok: false, error: "blocked" };

  return { ok: true, userAId, userBId };
}

export async function getOrCreateConversationForLockedPair(
  tx: Prisma.TransactionClient,
  pair: LockedConversationParticipantPair,
  requestedListingId: string | null,
) {
  const { userAId, userBId } = pair;
  const pairKey = `${userAId}:${userBId}`;

  // FOR SHARE locks do not conflict with another start for the same pair.
  // Only creation needs this advisory lock; ordinary sends reuse the User
  // lock/block protocol without serializing all messages between the pair.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${CONVERSATION_START_LOCK_NAMESPACE},
      hashtext(${pairKey})
    )
  `;

  let contextListingId: string | null = null;
  if (requestedListingId) {
    const listing = await lockConversationContextListingForPair(
      tx,
      pair,
      requestedListingId,
    );
    contextListingId = listing?.id ?? null;
  }

  const existing = await tx.conversation.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
    select: { id: true, contextListingId: true },
  });
  if (existing) {
    if (contextListingId && !existing.contextListingId) {
      await tx.conversation.updateMany({
        where: { id: existing.id, contextListingId: null },
        data: { contextListingId },
      });
    }
    return { conversationId: existing.id, created: false };
  }

  const created = await tx.conversation.create({
    data: {
      id: randomUUID(),
      userAId,
      userBId,
      contextListingId: contextListingId ?? undefined,
    },
    select: { id: true },
  });
  return { conversationId: created.id, created: true };
}

export async function startConversationForUser(
  userId: string,
  otherUserId: string,
  requestedListingId: string | null,
): Promise<ConversationStartResult> {
  return prisma.$transaction(async (tx) => {
    const pair = await lockConversationParticipantPair(tx, userId, otherUserId);
    if (!pair.ok) return pair;
    const conversation = await getOrCreateConversationForLockedPair(
      tx,
      pair,
      requestedListingId,
    );
    return { ok: true as const, ...conversation };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}
