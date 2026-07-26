import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MessageCursor } from "@/lib/messageCursor";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";

export type ConversationMessageAuthorityClient = Pick<
  Prisma.TransactionClient,
  "$queryRaw"
>;

export type ActorConversation = {
  id: string;
  userAId: string;
  userBId: string;
  contextListingId: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAAt: Date | null;
  archivedBAt: Date | null;
  firstResponseAt: Date | null;
  lastMessageEmailSentAt: Date | null;
};

export type ActorMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  kind: string | null;
  contextListing: {
    id: string;
    title: string;
  } | null;
  createdAt: Date;
  readAt: Date | null;
};

type ConversationRpcRow = ActorConversation;

type MessageRpcRow = {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  body: string;
  kind: string | null;
  contextListingId: string | null;
  contextListingTitle: string | null;
  createdAt: Date;
  readAt: Date | null;
};

type CountValue = number | bigint;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableDate(value: unknown): value is Date | null {
  return value === null || value instanceof Date;
}

function isBoundedAuthorityId(value: string): boolean {
  return value.length > 0 && value.length <= 191;
}

function requireSafeCount(value: CountValue, label: string): number {
  const count = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`${label} returned an invalid count`);
  }
  return count;
}

function validateConversationRow(
  row: ConversationRpcRow,
  expectedConversationId: string,
): ActorConversation {
  if (
    typeof row !== "object"
    || row === null
    || row.id !== expectedConversationId
    || typeof row.userAId !== "string"
    || typeof row.userBId !== "string"
    || row.userAId === row.userBId
    || !isNullableString(row.contextListingId)
    || !(row.createdAt instanceof Date)
    || !(row.updatedAt instanceof Date)
    || !isNullableDate(row.archivedAAt)
    || !isNullableDate(row.archivedBAt)
    || !isNullableDate(row.firstResponseAt)
    || !isNullableDate(row.lastMessageEmailSentAt)
  ) {
    throw new TypeError("conversation recipient RPC returned an invalid row");
  }
  return row;
}

function validateMessageRow(
  row: MessageRpcRow,
  expectedConversationId: string,
): ActorMessage {
  if (
    typeof row !== "object"
    || row === null
    || typeof row.id !== "string"
    || row.conversationId !== expectedConversationId
    || typeof row.senderId !== "string"
    || typeof row.recipientId !== "string"
    || row.senderId === row.recipientId
    || typeof row.body !== "string"
    || !isNullableString(row.kind)
    || !isNullableString(row.contextListingId)
    || !isNullableString(row.contextListingTitle)
    || !(row.createdAt instanceof Date)
    || !isNullableDate(row.readAt)
    || (
      (row.contextListingId === null)
      !== (row.contextListingTitle === null)
    )
  ) {
    throw new TypeError("message recipient RPC returned an invalid row");
  }

  return {
    id: row.id,
    senderId: row.senderId,
    recipientId: row.recipientId,
    body: row.body,
    kind: row.kind,
    contextListing: row.contextListingId === null
      ? null
      : {
          id: row.contextListingId,
          title: row.contextListingTitle as string,
        },
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}

export async function getActorConversation(
  userId: string,
  conversationId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<ActorConversation | null> {
  const actorId = normalizeDbUserContextUserId(userId);
  // Path ids were historically treated as a missing/forbidden thread. Keep
  // malformed paths out of PostgreSQL so the stricter function contract does
  // not turn that behavior into an internal error.
  if (!isBoundedAuthorityId(conversationId)) return null;
  const rows = await db.$queryRaw<ConversationRpcRow[]>`
    SELECT *
      FROM public.grainline_conversation_get(
        ${actorId}::text,
        ${conversationId}::text
      )
  `;
  if (rows.length > 1) {
    throw new TypeError("conversation recipient RPC returned multiple rows");
  }
  return rows.length === 0
    ? null
    : validateConversationRow(rows[0], conversationId);
}

export async function listActorMessages(
  userId: string,
  conversationId: string,
  {
    direction,
    cursor,
    limit,
  }: {
    direction: "before" | "after";
    cursor: MessageCursor | null;
    limit: number;
  },
  db: ConversationMessageAuthorityClient = prisma,
): Promise<ActorMessage[]> {
  const actorId = normalizeDbUserContextUserId(userId);
  if (
    !isBoundedAuthorityId(conversationId)
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 201
  ) {
    throw new TypeError("message recipient RPC input is invalid");
  }
  const rows = await db.$queryRaw<MessageRpcRow[]>`
    SELECT *
      FROM public.grainline_message_list(
        ${actorId}::text,
        ${conversationId}::text,
        ${direction}::text,
        ${cursor?.createdAt ?? null}::timestamp,
        ${cursor?.id ?? null}::text,
        ${limit}::integer
      )
  `;
  return rows.map((row) => validateMessageRow(row, conversationId));
}

export async function countActorUnreadMessages(
  userId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<number> {
  const actorId = normalizeDbUserContextUserId(userId);
  const rows = await db.$queryRaw<Array<{ count: CountValue }>>`
    SELECT public.grainline_message_unread_count(
      ${actorId}::text
    ) AS count
  `;
  if (rows.length !== 1) {
    throw new TypeError("message unread RPC returned no row");
  }
  return requireSafeCount(rows[0].count, "message unread RPC");
}

export async function markActorConversationMessagesRead(
  userId: string,
  conversationId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<{ count: number }> {
  const actorId = normalizeDbUserContextUserId(userId);
  if (!isBoundedAuthorityId(conversationId)) {
    throw new TypeError("message mark-read RPC input is invalid");
  }
  const rows = await db.$queryRaw<Array<{ count: CountValue }>>`
    SELECT public.grainline_message_mark_read(
      ${actorId}::text,
      ${conversationId}::text
    ) AS count
  `;
  if (rows.length !== 1) {
    throw new TypeError("message mark-read RPC returned no row");
  }
  return {
    count: requireSafeCount(rows[0].count, "message mark-read RPC"),
  };
}
