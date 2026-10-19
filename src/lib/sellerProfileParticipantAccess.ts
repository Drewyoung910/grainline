import type { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";

type SellerConversationParticipantCardRow = {
  sellerProfileId: string;
  userId: string;
  displayName: string;
  avatarImageUrl: string | null;
  acceptsCustomOrders: boolean;
  chargesEnabled: boolean;
  stripeAccountSupported: boolean;
};

type SellerConversationParticipantClient = Pick<Prisma.TransactionClient, "$queryRaw">;

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCardRow(
  row: SellerConversationParticipantCardRow | undefined,
  requestedUserIds: Set<string>,
): row is SellerConversationParticipantCardRow {
  return Boolean(
    row
    && typeof row.sellerProfileId === "string"
    && row.sellerProfileId.length > 0
    && row.sellerProfileId.length <= 191
    && requestedUserIds.has(row.userId)
    && typeof row.displayName === "string"
    && row.displayName.length <= 100
    && nullableString(row.avatarImageUrl)
    && typeof row.acceptsCustomOrders === "boolean"
    && typeof row.chargesEnabled === "boolean"
    && typeof row.stripeAccountSupported === "boolean"
  );
}

async function readSellerConversationParticipantCards(
  client: SellerConversationParticipantClient,
  targetUserIds: string[],
) {
  const rows = await client.$queryRaw<SellerConversationParticipantCardRow[]>`
    SELECT *
      FROM public.grainline_seller_actor_conversation_cards(
        ${targetUserIds}::text[]
      )
  `;
  const requestedUserIds = new Set(targetUserIds);
  if (
    rows.length > targetUserIds.length
    || rows.some((row) => !isCardRow(row, requestedUserIds))
    || new Set(rows.map((row) => row.userId)).size !== rows.length
    || new Set(rows.map((row) => row.sellerProfileId)).size !== rows.length
  ) {
    throw new TypeError("Seller conversation participant authority returned an invalid result");
  }
  return rows;
}

export function sellerConversationParticipantCards(
  actorUserId: string,
  targetUserIds: string[],
) {
  const actorId = normalizeDbUserContextUserId(actorUserId);
  const normalizedTargets = [...new Set(
    targetUserIds.map((targetUserId) => normalizeDbUserContextUserId(targetUserId)),
  )];
  if (normalizedTargets.length === 0) {
    return Promise.resolve([] as SellerConversationParticipantCardRow[]);
  }
  if (normalizedTargets.length > 51) {
    throw new TypeError("Seller conversation participant target set is too large");
  }
  return withDbUserContext(actorId, (client) =>
    readSellerConversationParticipantCards(client, normalizedTargets));
}
