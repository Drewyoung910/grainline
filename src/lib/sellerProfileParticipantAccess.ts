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

export type SellerAccountFeedCard = Readonly<{
  id: string;
  displayName: string;
  guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
}>;

type SellerAccountFeedCardRow = {
  id: unknown;
  displayName: unknown;
  guildLevel: unknown;
};

type SellerOwnerFollowExportAuthorityRow = {
  sellerProfileId: unknown;
  createdAt: unknown;
  displayName: unknown;
};

export type SellerOwnerFollowExportRow = Readonly<{
  sellerProfileId: string;
  createdAt: Date;
  sellerProfile: Readonly<{ displayName: string }>;
}>;

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

async function readSellerActorAccountFeedCards(
  client: SellerConversationParticipantClient,
  sellerProfileIds: string[],
) {
  const rows = await client.$queryRaw<SellerAccountFeedCardRow[]>`
    SELECT *
      FROM public.grainline_seller_actor_account_feed_cards(
        ${sellerProfileIds}::text[]
      )
  `;
  const requestedIds = new Set(sellerProfileIds);
  if (
    rows.length > sellerProfileIds.length
    || rows.some((row) => (
      typeof row.id !== "string"
      || !requestedIds.has(row.id)
      || typeof row.displayName !== "string"
      || row.displayName.length < 1
      || row.displayName.length > 100
      || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
    ))
    || new Set(rows.map((row) => row.id)).size !== rows.length
  ) {
    throw new TypeError("Seller account-feed authority returned an invalid result");
  }
  return rows.map((row) => Object.freeze({
    id: row.id as string,
    displayName: row.displayName as string,
    guildLevel: row.guildLevel as SellerAccountFeedCard["guildLevel"],
  }));
}

export function sellerActorAccountFeedCards(
  actorUserId: string,
  sellerProfileIds: string[],
) {
  const actorId = normalizeDbUserContextUserId(actorUserId);
  const normalizedTargets = [...new Set(
    sellerProfileIds.map((sellerProfileId) => normalizeDbUserContextUserId(sellerProfileId)),
  )];
  if (normalizedTargets.length === 0) {
    return Promise.resolve([] as SellerAccountFeedCard[]);
  }
  if (normalizedTargets.length > 1000) {
    throw new TypeError("Seller account-feed target set is too large");
  }
  return withDbUserContext(actorId, (client) =>
    readSellerActorAccountFeedCards(client, normalizedTargets));
}

async function readSellerOwnerFollowExportRows(
  client: SellerConversationParticipantClient,
) {
  const rows = await client.$queryRaw<SellerOwnerFollowExportAuthorityRow[]>`
    SELECT * FROM public.grainline_seller_owner_follow_export()
  `;
  if (
    rows.some((row) => (
      typeof row.sellerProfileId !== "string"
      || !row.sellerProfileId
      || !(row.createdAt instanceof Date)
      || Number.isNaN(row.createdAt.getTime())
      || typeof row.displayName !== "string"
      || row.displayName.length > 100
    ))
    || new Set(rows.map((row) => row.sellerProfileId)).size !== rows.length
  ) {
    throw new TypeError("Seller owner follow-export authority returned an invalid result");
  }
  return rows.map((row) => Object.freeze({
    sellerProfileId: row.sellerProfileId as string,
    createdAt: row.createdAt as Date,
    sellerProfile: Object.freeze({ displayName: row.displayName as string }),
  }));
}

export function sellerOwnerFollowExportRows(actorUserId: string) {
  const actorId = normalizeDbUserContextUserId(actorUserId);
  return withDbUserContext(actorId, readSellerOwnerFollowExportRows);
}
