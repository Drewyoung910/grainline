import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canAttachConversationContextListing } from "@/lib/conversationStartState";

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
  const pairKey = `${userAId}:${userBId}`;

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

  // FOR SHARE locks do not conflict with another start for the same pair.
  // This narrow advisory lock serializes the find/create path so a unique
  // violation cannot abort the surrounding transaction.
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${CONVERSATION_START_LOCK_NAMESPACE},
      hashtext(${pairKey})
    )
  `;

  return { ok: true, userAId, userBId };
}

export async function getOrCreateConversationForLockedPair(
  tx: Prisma.TransactionClient,
  pair: LockedConversationParticipantPair,
  requestedListingId: string | null,
) {
  const { userAId, userBId } = pair;
  let contextListingId: string | null = null;
  if (requestedListingId) {
    const listing = await tx.listing.findUnique({
      where: { id: requestedListingId },
      select: {
        id: true,
        status: true,
        isPrivate: true,
        reservedForUserId: true,
        seller: {
          select: {
            chargesEnabled: true,
            stripeAccountVersion: true,
            vacationMode: true,
            user: { select: { id: true, banned: true, deletedAt: true } },
          },
        },
      },
    });
    if (listing && canAttachConversationContextListing(listing, [userAId, userBId])) {
      contextListingId = listing.id;
    }
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
