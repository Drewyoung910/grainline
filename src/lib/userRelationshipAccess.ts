import type { Prisma } from "@prisma/client";

type UserRelationshipClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type UserRelationshipTargetState = {
  id: string;
  name: string | null;
  banned: boolean;
  deletedAt: Date | null;
};

export type UserConversationParticipant = UserRelationshipTargetState & {
  imageUrl: string | null;
};

export type UserCustomOrderSellerState = {
  userId: string;
  banned: boolean;
  deletedAt: Date | null;
  sellerProfileId: string | null;
  acceptsCustomOrders: boolean | null;
  acceptingNewOrders: boolean | null;
  stripeAccountId: string | null;
  stripeAccountVersion: string | null;
  chargesEnabled: boolean | null;
  vacationMode: boolean | null;
  displayName: string | null;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableDate(value: unknown): value is Date | null {
  return value === null || value instanceof Date;
}

function validTarget(row: UserRelationshipTargetState | undefined) {
  return Boolean(
    row
    && typeof row.id === "string"
    && nullableString(row.name)
    && typeof row.banned === "boolean"
    && nullableDate(row.deletedAt),
  );
}

export async function userRelationshipTargetState(
  client: UserRelationshipClient,
  input: { actorId: string; targetId: string },
) {
  const rows = await client.$queryRaw<UserRelationshipTargetState[]>`
    SELECT * FROM public.grainline_user_relationship_target_state(
      ${input.actorId}::text,
      ${input.targetId}::text
    )
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1 || !validTarget(rows[0])) {
    throw new Error("User relationship target authority returned an invalid result");
  }
  return rows[0];
}

export async function userConversationParticipants(
  client: UserRelationshipClient,
  input: { actorId: string; conversationId: string },
) {
  const rows = await client.$queryRaw<UserConversationParticipant[]>`
    SELECT * FROM public.grainline_user_conversation_participants(
      ${input.actorId}::text,
      ${input.conversationId}::text
    )
  `;
  if (
    rows.length !== 2
    || rows.some((row) => !validTarget(row) || !nullableString(row.imageUrl))
    || rows[0].id === rows[1].id
  ) {
    throw new Error("User conversation participant authority returned an invalid result");
  }
  return rows;
}

export async function userCustomOrderSellerState(
  client: UserRelationshipClient,
  input: { buyerId: string; sellerUserId: string },
) {
  const rows = await client.$queryRaw<UserCustomOrderSellerState[]>`
    SELECT * FROM public.grainline_user_custom_order_seller_state(
      ${input.buyerId}::text,
      ${input.sellerUserId}::text
    )
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || row.userId !== input.sellerUserId
    || typeof row.banned !== "boolean"
    || !nullableDate(row.deletedAt)
    || !nullableString(row.sellerProfileId)
    || (row.acceptsCustomOrders !== null && typeof row.acceptsCustomOrders !== "boolean")
    || (row.acceptingNewOrders !== null && typeof row.acceptingNewOrders !== "boolean")
    || !nullableString(row.stripeAccountId)
    || !nullableString(row.stripeAccountVersion)
    || (row.chargesEnabled !== null && typeof row.chargesEnabled !== "boolean")
    || (row.vacationMode !== null && typeof row.vacationMode !== "boolean")
    || !nullableString(row.displayName)
    || (
      row.sellerProfileId !== null
      && (
        typeof row.acceptsCustomOrders !== "boolean"
        || typeof row.acceptingNewOrders !== "boolean"
        || typeof row.chargesEnabled !== "boolean"
        || typeof row.vacationMode !== "boolean"
        || typeof row.displayName !== "string"
      )
    )
  ) {
    throw new Error("User custom-order seller authority returned an invalid result");
  }
  return row;
}

export async function userOwnerNotificationPreferences(
  client: UserRelationshipClient,
  userId: string,
) {
  const rows = await client.$queryRaw<Array<{ preferences: unknown }>>`
    SELECT public.grainline_user_owner_notification_preferences(
      ${userId}::text
    ) AS preferences
  `;
  if (rows.length !== 1) {
    throw new Error("User owner notification preference authority returned an invalid result");
  }
  return rows[0].preferences;
}
