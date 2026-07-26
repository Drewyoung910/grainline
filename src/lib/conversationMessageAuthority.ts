import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
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

export type ActorMessageExport = {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  body: string;
  kind: string | null;
  isSystemMessage: boolean;
  readAt: Date | null;
  createdAt: Date;
};

export type ActorSentMessageBody = {
  body: string;
};

export type ActorMessageDeletionRedaction = {
  sentRedacted: number;
  receivedRedacted: number;
};

export type ActorInboxConversation = {
  id: string;
  userAId: string;
  userBId: string;
  userA: {
    id: string;
    name: string | null;
    imageUrl: string | null;
  };
  userB: {
    id: string;
    name: string | null;
    imageUrl: string | null;
  };
  updatedAt: Date;
  archivedAAt: Date | null;
  archivedBAt: Date | null;
  contextListing: {
    id: string;
    title: string;
    photoUrl: string | null;
  } | null;
  latestMessage: {
    id: string;
    body: string;
    kind: string | null;
    createdAt: Date;
    senderId: string;
  };
  unreadCount: number;
};

export type ActorCustomOrderRequest = {
  body: string;
  createdAt: Date;
};

export type StartedActorConversation = {
  conversationId: string;
  created: boolean;
  contextListingId: string | null;
};

export type SentActorCustomOrderRequest = {
  conversationId: string;
  messageId: string;
  listingId: string | null;
  listingTitle: string | null;
};

export type CreatedActorCommissionInterest = {
  conversationId: string;
  messageId: string;
  commissionInterestId: string;
  buyerUserId: string;
  commissionTitle: string;
  sellerDisplayName: string;
  created: boolean;
};

export type SentActorCustomOrderReady = {
  messageId: string;
  conversationId: string;
  sellerUserId: string;
  buyerUserId: string;
  listingId: string;
  listingTitle: string;
  priceCents: number;
  currency: string;
  sellerName: string | null;
  created: boolean;
};

export type SentActorOrdinaryMessage = {
  messageId: string;
  recipientId: string;
  sentAt: Date;
  firstResponseSet: boolean;
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

type ConversationInboxRpcRow = {
  id: string;
  userAId: string;
  userBId: string;
  userAName: string | null;
  userAImageUrl: string | null;
  userBName: string | null;
  userBImageUrl: string | null;
  updatedAt: Date;
  archivedAAt: Date | null;
  archivedBAt: Date | null;
  contextListingId: string | null;
  contextListingTitle: string | null;
  contextListingPhotoUrl: string | null;
  latestMessageId: string;
  latestMessageBody: string;
  latestMessageKind: string | null;
  latestMessageCreatedAt: Date;
  latestMessageSenderId: string;
  unreadCount: CountValue;
};

type CountValue = number | bigint;
type MessageReportTargetType = "MESSAGE" | "MESSAGE_THREAD";

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

function validateMessageExportRow(row: ActorMessageExport): ActorMessageExport {
  if (
    typeof row !== "object"
    || row === null
    || typeof row.id !== "string"
    || typeof row.conversationId !== "string"
    || typeof row.senderId !== "string"
    || typeof row.recipientId !== "string"
    || row.senderId === row.recipientId
    || typeof row.body !== "string"
    || !isNullableString(row.kind)
    || typeof row.isSystemMessage !== "boolean"
    || !isNullableDate(row.readAt)
    || !(row.createdAt instanceof Date)
  ) {
    throw new TypeError("message export RPC returned an invalid row");
  }
  return row;
}

function validateConversationInboxRow(
  row: ConversationInboxRpcRow,
  actorId: string,
  archived: boolean,
): ActorInboxConversation {
  if (
    typeof row !== "object"
    || row === null
    || typeof row.id !== "string"
    || !isBoundedAuthorityId(row.id)
    || typeof row.userAId !== "string"
    || !isBoundedAuthorityId(row.userAId)
    || typeof row.userBId !== "string"
    || !isBoundedAuthorityId(row.userBId)
    || row.userAId === row.userBId
    || ![row.userAId, row.userBId].includes(actorId)
    || !isNullableString(row.userAName)
    || !isNullableString(row.userAImageUrl)
    || !isNullableString(row.userBName)
    || !isNullableString(row.userBImageUrl)
    || !(row.updatedAt instanceof Date)
    || !isNullableDate(row.archivedAAt)
    || !isNullableDate(row.archivedBAt)
    || !isNullableString(row.contextListingId)
    || !isNullableString(row.contextListingTitle)
    || !isNullableString(row.contextListingPhotoUrl)
    || (
      (row.contextListingId === null)
      !== (row.contextListingTitle === null)
    )
    || (
      row.contextListingId !== null
      && !isBoundedAuthorityId(row.contextListingId)
    )
    || (row.contextListingId === null && row.contextListingPhotoUrl !== null)
    || typeof row.latestMessageId !== "string"
    || !isBoundedAuthorityId(row.latestMessageId)
    || typeof row.latestMessageBody !== "string"
    || !isNullableString(row.latestMessageKind)
    || !(row.latestMessageCreatedAt instanceof Date)
    || typeof row.latestMessageSenderId !== "string"
    || !isBoundedAuthorityId(row.latestMessageSenderId)
    || ![row.userAId, row.userBId].includes(row.latestMessageSenderId)
    || (
      archived
      !== (
        row.userAId === actorId
          ? row.archivedAAt !== null
          : row.archivedBAt !== null
      )
    )
  ) {
    throw new TypeError("conversation inbox RPC returned an invalid row");
  }

  return {
    id: row.id,
    userAId: row.userAId,
    userBId: row.userBId,
    userA: {
      id: row.userAId,
      name: row.userAName,
      imageUrl: row.userAImageUrl,
    },
    userB: {
      id: row.userBId,
      name: row.userBName,
      imageUrl: row.userBImageUrl,
    },
    updatedAt: row.updatedAt,
    archivedAAt: row.archivedAAt,
    archivedBAt: row.archivedBAt,
    contextListing: row.contextListingId === null
      ? null
      : {
          id: row.contextListingId,
          title: row.contextListingTitle as string,
          photoUrl: row.contextListingPhotoUrl,
        },
    latestMessage: {
      id: row.latestMessageId,
      body: row.latestMessageBody,
      kind: row.latestMessageKind,
      createdAt: row.latestMessageCreatedAt,
      senderId: row.latestMessageSenderId,
    },
    unreadCount: requireSafeCount(
      row.unreadCount,
      "conversation inbox unread count",
    ),
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

export async function listLatestActorMessages(
  userId: string,
  conversation: Pick<ActorConversation, "id" | "updatedAt">,
  limit: number,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<ActorMessage[]> {
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 201
    || !(conversation.updatedAt instanceof Date)
    || !Number.isFinite(conversation.updatedAt.getTime())
    || conversation.updatedAt.getTime() >= 8_640_000_000_000_000
  ) {
    throw new TypeError("latest message recipient RPC input is invalid");
  }

  // The fixed before-page projection is newest-first and requires a complete
  // cursor. Conversation.updatedAt is kept monotonic with Message.createdAt by
  // the insert trigger; one millisecond makes the bound exclusive even when
  // the newest message and conversation share the same timestamp. The
  // conversation id is only the required tie-break value because every
  // included message timestamp is strictly below this upper bound.
  const rows = await listActorMessages(
    userId,
    conversation.id,
    {
      direction: "before",
      cursor: {
        createdAt: new Date(conversation.updatedAt.getTime() + 1),
        id: conversation.id,
      },
      limit,
    },
    db,
  );
  return rows.reverse();
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

export async function listActorConversationInbox(
  userId: string,
  {
    archived,
    query,
    cursor,
    limit,
  }: {
    archived: boolean;
    query: string;
    cursor: MessageCursor | null;
    limit: number;
  },
  db: ConversationMessageAuthorityClient = prisma,
): Promise<ActorInboxConversation[]> {
  const actorId = normalizeDbUserContextUserId(userId);
  if (
    typeof archived !== "boolean"
    || typeof query !== "string"
    || query.length > 200
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 51
    || (
      cursor !== null
      && (
        !(cursor.createdAt instanceof Date)
        || !Number.isFinite(cursor.createdAt.getTime())
        || cursor.id === null
        || !isBoundedAuthorityId(cursor.id)
      )
    )
  ) {
    throw new TypeError("conversation inbox RPC input is invalid");
  }
  const rows = await db.$queryRaw<ConversationInboxRpcRow[]>`
    SELECT *
      FROM public.grainline_conversation_inbox(
        ${actorId}::text,
        ${archived}::boolean,
        ${query}::text,
        ${cursor?.createdAt ?? null}::timestamp,
        ${cursor?.id ?? null}::text,
        ${limit}::integer
      )
  `;
  return rows.map((row) =>
    validateConversationInboxRow(row, actorId, archived)
  );
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

export async function sendActorOrdinaryMessage(
  userId: string,
  conversationId: string,
  {
    body,
    kind,
    contextListingId,
  }: {
    body: string;
    kind: "file" | null;
    contextListingId: string | null;
  },
  db: ConversationMessageAuthorityClient = prisma,
): Promise<SentActorOrdinaryMessage> {
  const actorId = normalizeDbUserContextUserId(userId);
  if (
    !isBoundedAuthorityId(conversationId)
    || typeof body !== "string"
    || body.length < 1
    || body.length > 5000
    || (kind !== null && kind !== "file")
    || (
      contextListingId !== null
      && !isBoundedAuthorityId(contextListingId)
    )
  ) {
    throw new TypeError("ordinary-message write RPC input is invalid");
  }

  const messageId = randomUUID();
  const rows = await db.$queryRaw<SentActorOrdinaryMessage[]>`
    SELECT *
      FROM public.grainline_message_send_ordinary(
        ${messageId}::text,
        ${actorId}::text,
        ${conversationId}::text,
        ${body}::text,
        ${kind}::text,
        ${contextListingId}::text
      )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || row.messageId !== messageId
    || !isBoundedAuthorityId(row.messageId)
    || typeof row.recipientId !== "string"
    || !isBoundedAuthorityId(row.recipientId)
    || row.recipientId === actorId
    || !(row.sentAt instanceof Date)
    || !Number.isFinite(row.sentAt.getTime())
    || typeof row.firstResponseSet !== "boolean"
  ) {
    throw new TypeError("ordinary-message write RPC returned an invalid row");
  }
  return row;
}

export async function setActorConversationArchived(
  userId: string,
  conversationId: string,
  archived: boolean,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<boolean> {
  const actorId = normalizeDbUserContextUserId(userId);
  if (
    !isBoundedAuthorityId(conversationId)
    || typeof archived !== "boolean"
  ) {
    throw new TypeError("conversation archive RPC input is invalid");
  }
  const rows = await db.$queryRaw<Array<{ changed: boolean }>>`
    SELECT public.grainline_conversation_set_archived(
      ${actorId}::text,
      ${conversationId}::text,
      ${archived}::boolean
    ) AS changed
  `;
  if (rows.length !== 1 || typeof rows[0].changed !== "boolean") {
    throw new TypeError("conversation archive RPC returned an invalid result");
  }
  return rows[0].changed;
}

export async function claimActorConversationMessageEmail(
  userId: string,
  messageId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<boolean> {
  const actorId = normalizeDbUserContextUserId(userId);
  if (!isBoundedAuthorityId(messageId)) {
    throw new TypeError("message email-claim RPC input is invalid");
  }
  const rows = await db.$queryRaw<Array<{ claimed: boolean }>>`
    SELECT public.grainline_conversation_claim_message_email(
      ${actorId}::text,
      ${messageId}::text
    ) AS claimed
  `;
  if (rows.length !== 1 || typeof rows[0].claimed !== "boolean") {
    throw new TypeError("message email-claim RPC returned an invalid result");
  }
  return rows[0].claimed;
}

export async function exportActorMessages(
  userId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<ActorMessageExport[]> {
  const actorId = normalizeDbUserContextUserId(userId);
  const rows = await db.$queryRaw<ActorMessageExport[]>`
    SELECT *
      FROM public.grainline_message_export(
        ${actorId}::text
      )
  `;
  return rows.map(validateMessageExportRow);
}

export async function listActorSentMessageBodiesForDeletion(
  userId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<ActorSentMessageBody[]> {
  const actorId = normalizeDbUserContextUserId(userId);
  const rows = await db.$queryRaw<ActorSentMessageBody[]>`
    SELECT message_export.body
      FROM public.grainline_message_export(
        ${actorId}::text
      ) AS message_export
     WHERE message_export."senderId" = ${actorId}::text
  `;
  return rows.map((row) => {
    if (
      typeof row !== "object"
      || row === null
      || typeof row.body !== "string"
    ) {
      throw new TypeError(
        "account-deletion message media projection returned an invalid row",
      );
    }
    return row;
  });
}

export async function redactActorMessagesForAccountDeletion(
  userId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<ActorMessageDeletionRedaction> {
  const actorId = normalizeDbUserContextUserId(userId);
  const rows = await db.$queryRaw<Array<{
    sentRedacted: CountValue;
    receivedRedacted: CountValue;
  }>>`
    SELECT *
      FROM public.grainline_message_redact_for_account_deletion(
        ${actorId}::text
      )
  `;
  if (rows.length !== 1) {
    throw new TypeError(
      "account-deletion message redaction RPC returned an invalid row",
    );
  }
  return {
    sentRedacted: requireSafeCount(
      rows[0].sentRedacted,
      "account-deletion sent-message redaction RPC",
    ),
    receivedRedacted: requireSafeCount(
      rows[0].receivedRedacted,
      "account-deletion received-message redaction RPC",
    ),
  };
}

export async function isActorMessageReportTarget(
  userId: string,
  reportedUserId: string,
  targetType: MessageReportTargetType,
  targetId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<boolean> {
  const actorId = normalizeDbUserContextUserId(userId);
  const rows = await db.$queryRaw<Array<{ valid: boolean }>>`
    SELECT public.grainline_message_report_target_valid(
      ${actorId}::text,
      ${reportedUserId}::text,
      ${targetType}::text,
      ${targetId}::text
    ) AS valid
  `;
  if (rows.length !== 1 || typeof rows[0].valid !== "boolean") {
    throw new TypeError("message report-target RPC returned an invalid result");
  }
  return rows[0].valid;
}

export async function findActorConversationPair(
  userId: string,
  otherUserId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<{ id: string } | null> {
  const actorId = normalizeDbUserContextUserId(userId);
  if (
    !isBoundedAuthorityId(otherUserId)
    || actorId === otherUserId
  ) {
    return null;
  }
  const rows = await db.$queryRaw<Array<{ id: string | null }>>`
    SELECT public.grainline_conversation_pair(
      ${actorId}::text,
      ${otherUserId}::text
    ) AS id
  `;
  if (
    rows.length !== 1
    || (rows[0].id !== null && !isBoundedAuthorityId(rows[0].id))
  ) {
    throw new TypeError("conversation pair RPC returned an invalid result");
  }
  return rows[0].id === null ? null : { id: rows[0].id };
}

export async function findLatestActorCustomOrderRequest(
  userId: string,
  conversationId: string,
  buyerUserId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<ActorCustomOrderRequest | null> {
  const actorId = normalizeDbUserContextUserId(userId);
  if (
    !isBoundedAuthorityId(conversationId)
    || !isBoundedAuthorityId(buyerUserId)
  ) {
    return null;
  }
  const rows = await db.$queryRaw<ActorCustomOrderRequest[]>`
    SELECT *
      FROM public.grainline_message_latest_custom_request(
        ${actorId}::text,
        ${conversationId}::text,
        ${buyerUserId}::text
      )
  `;
  if (rows.length > 1) {
    throw new TypeError("custom-request RPC returned multiple rows");
  }
  const row = rows[0];
  if (
    row !== undefined
    && (
      typeof row.body !== "string"
      || !(row.createdAt instanceof Date)
    )
  ) {
    throw new TypeError("custom-request RPC returned an invalid row");
  }
  return row ?? null;
}

export async function startActorConversation(
  userId: string,
  otherUserId: string,
  requestedListingId: string | null,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<StartedActorConversation> {
  const actorId = normalizeDbUserContextUserId(userId);
  const rows = await db.$queryRaw<StartedActorConversation[]>`
    SELECT *
      FROM public.grainline_conversation_start(
        ${randomUUID()}::text,
        ${actorId}::text,
        ${otherUserId}::text,
        ${requestedListingId}::text
      )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || typeof row.conversationId !== "string"
    || !isBoundedAuthorityId(row.conversationId)
    || typeof row.created !== "boolean"
    || !isNullableString(row.contextListingId)
  ) {
    throw new TypeError("conversation start RPC returned an invalid row");
  }
  return row;
}

export async function sendActorCustomOrderRequest(
  input: {
    buyerUserId: string;
    sellerUserId: string;
    description: string;
    dimensions: string | null;
    budgetCents: number | null;
    timeline: string | null;
    listingId: string | null;
  },
  db: ConversationMessageAuthorityClient = prisma,
): Promise<SentActorCustomOrderRequest> {
  const buyerUserId = normalizeDbUserContextUserId(input.buyerUserId);
  const sellerUserId = normalizeDbUserContextUserId(input.sellerUserId);
  const rows = await db.$queryRaw<SentActorCustomOrderRequest[]>`
    SELECT *
      FROM public.grainline_message_send_custom_request(
        ${randomUUID()}::text,
        ${randomUUID()}::text,
        ${buyerUserId}::text,
        ${sellerUserId}::text,
        ${input.description}::text,
        ${input.dimensions}::text,
        ${input.budgetCents}::integer,
        ${input.timeline}::text,
        ${input.listingId}::text
      )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || typeof row.conversationId !== "string"
    || !isBoundedAuthorityId(row.conversationId)
    || typeof row.messageId !== "string"
    || !isBoundedAuthorityId(row.messageId)
    || !isNullableString(row.listingId)
    || !isNullableString(row.listingTitle)
    || ((row.listingId === null) !== (row.listingTitle === null))
  ) {
    throw new TypeError("custom-request write RPC returned an invalid row");
  }
  return row;
}

export async function createActorCommissionInterest(
  input: {
    commissionRequestId: string;
    sellerUserId: string;
  },
  db: ConversationMessageAuthorityClient = prisma,
): Promise<CreatedActorCommissionInterest> {
  const sellerUserId = normalizeDbUserContextUserId(input.sellerUserId);
  if (!isBoundedAuthorityId(input.commissionRequestId)) {
    throw new TypeError("commission-interest write RPC input is invalid");
  }
  const rows = await db.$queryRaw<CreatedActorCommissionInterest[]>`
    SELECT *
      FROM public.grainline_message_create_commission_interest(
        ${randomUUID()}::text,
        ${randomUUID()}::text,
        ${randomUUID()}::text,
        ${sellerUserId}::text,
        ${input.commissionRequestId}::text
      )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || typeof row.conversationId !== "string"
    || !isBoundedAuthorityId(row.conversationId)
    || typeof row.messageId !== "string"
    || !isBoundedAuthorityId(row.messageId)
    || typeof row.commissionInterestId !== "string"
    || !isBoundedAuthorityId(row.commissionInterestId)
    || typeof row.buyerUserId !== "string"
    || !isBoundedAuthorityId(row.buyerUserId)
    || typeof row.commissionTitle !== "string"
    || typeof row.sellerDisplayName !== "string"
    || typeof row.created !== "boolean"
  ) {
    throw new TypeError("commission-interest write RPC returned an invalid row");
  }
  return row;
}

export async function sendActorCustomOrderReady(
  sellerUserId: string,
  listingId: string,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<SentActorCustomOrderReady> {
  const actorId = normalizeDbUserContextUserId(sellerUserId);
  if (!isBoundedAuthorityId(listingId)) {
    throw new TypeError("custom-order-ready write RPC input is invalid");
  }
  const rows = await db.$queryRaw<SentActorCustomOrderReady[]>`
    SELECT *
      FROM public.grainline_message_send_custom_order_ready(
        ${randomUUID()}::text,
        ${actorId}::text,
        ${listingId}::text
      )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || typeof row.messageId !== "string"
    || !isBoundedAuthorityId(row.messageId)
    || typeof row.conversationId !== "string"
    || !isBoundedAuthorityId(row.conversationId)
    || row.sellerUserId !== actorId
    || typeof row.buyerUserId !== "string"
    || !isBoundedAuthorityId(row.buyerUserId)
    || row.buyerUserId === actorId
    || row.listingId !== listingId
    || typeof row.listingTitle !== "string"
    || !Number.isSafeInteger(row.priceCents)
    || row.priceCents < 0
    || typeof row.currency !== "string"
    || row.currency.length !== 3
    || !isNullableString(row.sellerName)
    || typeof row.created !== "boolean"
  ) {
    throw new TypeError("custom-order-ready write RPC returned an invalid row");
  }
  return row;
}

export async function getSellerMessageResponseMetrics(
  sellerUserId: string,
  periodStart: Date,
  db: ConversationMessageAuthorityClient = prisma,
): Promise<{
  buyerInitiatedCount: number;
  sellerRespondedCount: number;
}> {
  const actorId = normalizeDbUserContextUserId(sellerUserId);
  if (
    !(periodStart instanceof Date)
    || !Number.isFinite(periodStart.getTime())
  ) {
    throw new TypeError("seller response metric RPC input is invalid");
  }
  const rows = await db.$queryRaw<Array<{
    buyerInitiatedCount: CountValue;
    sellerRespondedCount: CountValue;
  }>>`
    SELECT *
      FROM public.grainline_seller_message_response_metrics(
        ${actorId}::text,
        ${periodStart}::timestamp
      )
  `;
  if (rows.length !== 1) {
    throw new TypeError("seller response metric RPC returned an invalid row");
  }
  const buyerInitiatedCount = requireSafeCount(
    rows[0].buyerInitiatedCount,
    "seller response metric buyer count",
  );
  const sellerRespondedCount = requireSafeCount(
    rows[0].sellerRespondedCount,
    "seller response metric response count",
  );
  if (sellerRespondedCount > buyerInitiatedCount) {
    throw new TypeError("seller response metric RPC returned impossible counts");
  }
  return { buyerInitiatedCount, sellerRespondedCount };
}
