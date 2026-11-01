import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type DbUserContextTransactionClient,
  withDbUserContext,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type QueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;
type StaffQueryClient = Pick<PrismaClient, "$queryRaw">;

export type SellerBroadcastRow = Readonly<{
  id: string;
  message: string;
  imageUrl: string | null;
  sentAt: Date;
  recipientCount: number;
}>;

export type SellerBroadcastFeedRow = Readonly<{
  id: string;
  message: string;
  imageUrl: string | null;
  sentAt: Date;
  sellerProfileId: string;
}>;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validImageUrl(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string"
      && value.length <= 2048
      && value.startsWith("https://"));
}

function validCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 10000;
}

function checkedBroadcastRow(value: unknown): SellerBroadcastRow {
  if (!value || typeof value !== "object") {
    throw new TypeError("SellerBroadcast authority returned an invalid row");
  }
  const row = value as Record<string, unknown>;
  if (
    !validId(row.id)
    || !isTextWithinCodePointRange(row.message, 1, 500)
    || !validImageUrl(row.imageUrl)
    || !validDate(row.sentAt)
    || !validCount(row.recipientCount)
  ) {
    throw new TypeError("SellerBroadcast authority returned an invalid row");
  }
  return Object.freeze({
    id: row.id,
    message: row.message,
    imageUrl: row.imageUrl,
    sentAt: row.sentAt,
    recipientCount: row.recipientCount,
  });
}

export async function ownerSellerBroadcastCooldown(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{
      lastSentAt: unknown;
      nextAvailableAt: unknown;
    }>>`
      SELECT * FROM public.grainline_seller_broadcast_owner_cooldown()
    `;
    const row = rows[0];
    if (
      rows.length !== 1
      || !row
      || (row.lastSentAt !== null && !validDate(row.lastSentAt))
      || (row.nextAvailableAt !== null && !validDate(row.nextAvailableAt))
      || ((row.lastSentAt === null) !== (row.nextAvailableAt === null))
    ) {
      throw new TypeError("SellerBroadcast cooldown authority returned an invalid result");
    }
    return Object.freeze({
      lastSentAt: row.lastSentAt as Date | null,
      nextAvailableAt: row.nextAvailableAt as Date | null,
    });
  });
}

export async function createOwnerSellerBroadcast(
  client: DbUserContextTransactionClient,
  input: {
    message: string;
    imageUrl: string | null;
    provisionalRecipientCount: number;
  },
) {
  if (
    !isTextWithinCodePointRange(input.message, 1, 500)
    || !validImageUrl(input.imageUrl)
    || !validCount(input.provisionalRecipientCount)
  ) {
    throw new RangeError("SellerBroadcast create input is outside the supported range");
  }
  const proposedId = randomUUID();
  const rows = await client.$queryRaw<Array<{
    created: unknown;
    broadcastId: unknown;
    sentAt: unknown;
    nextAvailableAt: unknown;
  }>>`
    SELECT * FROM public.grainline_seller_broadcast_owner_create(
      ${proposedId}::text,
      ${input.message}::text,
      ${input.imageUrl}::text,
      ${input.provisionalRecipientCount}::integer
    )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || typeof row.created !== "boolean"
    || (row.created && (
      row.broadcastId !== proposedId
      || !validDate(row.sentAt)
      || row.nextAvailableAt !== null
    ))
    || (!row.created && (
      row.broadcastId !== null
      || row.sentAt !== null
      || !validDate(row.nextAvailableAt)
    ))
  ) {
    throw new TypeError("SellerBroadcast create authority returned an invalid result");
  }
  return row.created
    ? Object.freeze({ created: true as const, id: proposedId, sentAt: row.sentAt as Date })
    : Object.freeze({
      created: false as const,
      nextAvailableAt: row.nextAvailableAt as Date,
    });
}

export function ownerSellerBroadcastCount(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ value: unknown }>>`
      SELECT public.grainline_seller_broadcast_owner_count() AS value
    `;
    const value = typeof rows[0]?.value === "bigint"
      ? Number(rows[0].value)
      : rows[0]?.value;
    if (rows.length !== 1 || !Number.isSafeInteger(value) || Number(value) < 0) {
      throw new TypeError("SellerBroadcast count authority returned an invalid result");
    }
    return value as number;
  });
}

export function ownerSellerBroadcastPage(
  userId: string,
  input: { offset: number; limit: number },
) {
  if (
    !Number.isSafeInteger(input.offset)
    || input.offset < 0
    || input.offset > 9990
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 100
  ) {
    throw new RangeError("SellerBroadcast owner page is outside the supported range");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<unknown[]>`
      SELECT * FROM public.grainline_seller_broadcast_owner_page(
        ${input.offset}::integer,
        ${input.limit}::integer
      )
    `;
    return rows.map(checkedBroadcastRow);
  });
}

export function ownerSellerBroadcastExport(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<unknown[]>`
      SELECT * FROM public.grainline_seller_broadcast_owner_export()
    `;
    return rows.map(checkedBroadcastRow);
  });
}

async function readPublicLatest(client: QueryClient, sellerProfileId: string) {
  if (!validId(sellerProfileId)) {
    throw new RangeError("SellerBroadcast public seller id is invalid");
  }
  const rows = await client.$queryRaw<Array<{
    message: unknown;
    imageUrl: unknown;
    sentAt: unknown;
  }>>`
    SELECT * FROM public.grainline_seller_broadcast_public_latest(
      ${sellerProfileId}::text
    )
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || !isTextWithinCodePointRange(row.message, 1, 500)
    || !validImageUrl(row.imageUrl)
    || !validDate(row.sentAt)
  ) {
    throw new TypeError("SellerBroadcast public latest authority returned an invalid row");
  }
  return Object.freeze({
    message: row.message,
    imageUrl: row.imageUrl,
    sentAt: row.sentAt,
  });
}

export function publicLatestSellerBroadcast(
  viewerUserId: string | null,
  sellerProfileId: string,
) {
  return viewerUserId
    ? withDbUserContext(viewerUserId, (client) => readPublicLatest(client, sellerProfileId))
    : readPublicLatest(prisma, sellerProfileId);
}

export function actorSellerBroadcastFeedPage(
  userId: string,
  input: {
    sellerProfileIds: string[];
    cutoff: Date;
    cursor: Date | null;
    cursorId: string | null;
    sameTimestampMode: "none" | "all" | "after-id" | "exclude";
    limit: number;
  },
) {
  const sellerProfileIds = [...new Set(input.sellerProfileIds)];
  if (
    sellerProfileIds.length < 1
    || sellerProfileIds.length > 1000
    || sellerProfileIds.some((id) => !validId(id))
    || !validDate(input.cutoff)
    || (input.cursor !== null && !validDate(input.cursor))
    || (input.sameTimestampMode === "after-id" && !validId(input.cursorId))
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 51
  ) {
    throw new RangeError("SellerBroadcast feed input is outside the supported range");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{
      id: unknown;
      message: unknown;
      imageUrl: unknown;
      sentAt: unknown;
      sellerProfileId: unknown;
    }>>`
      SELECT * FROM public.grainline_seller_broadcast_actor_feed_page(
        ${sellerProfileIds}::text[],
        ${input.cutoff}::timestamp,
        ${input.cursor}::timestamp,
        ${input.cursorId}::text,
        ${input.sameTimestampMode}::text,
        ${input.limit}::integer
      )
    `;
    return rows.map((row) => {
      if (
        !validId(row.id)
        || !isTextWithinCodePointRange(row.message, 1, 500)
        || !validImageUrl(row.imageUrl)
        || !validDate(row.sentAt)
        || !validId(row.sellerProfileId)
        || !sellerProfileIds.includes(row.sellerProfileId)
      ) {
        throw new TypeError("SellerBroadcast feed authority returned an invalid row");
      }
      return Object.freeze({
        id: row.id,
        message: row.message,
        imageUrl: row.imageUrl,
        sentAt: row.sentAt,
        sellerProfileId: row.sellerProfileId,
      }) satisfies SellerBroadcastFeedRow;
    });
  });
}

export function ownerSellerBroadcastDeliverySource(
  userId: string,
  broadcastId: string,
) {
  if (!validId(broadcastId)) {
    throw new RangeError("SellerBroadcast delivery source id is invalid");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ sellerProfileId: unknown }>>`
      SELECT * FROM public.grainline_seller_broadcast_owner_delivery_source(
        ${broadcastId}::text
      )
    `;
    if (rows.length === 0) return null;
    if (rows.length !== 1 || !validId(rows[0]?.sellerProfileId)) {
      throw new TypeError("SellerBroadcast delivery source authority returned an invalid result");
    }
    return rows[0].sellerProfileId;
  });
}

export function recordOwnerSellerBroadcastDelivery(
  userId: string,
  broadcastId: string,
  deliveredCount: number,
) {
  if (!validId(broadcastId) || !validCount(deliveredCount)) {
    throw new RangeError("SellerBroadcast delivery result is outside the supported range");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ value: unknown }>>`
      SELECT public.grainline_seller_broadcast_owner_record_delivery(
        ${broadcastId}::text,
        ${deliveredCount}::integer
      ) AS value
    `;
    if (rows.length !== 1 || typeof rows[0]?.value !== "boolean") {
      throw new TypeError("SellerBroadcast delivery authority returned an invalid result");
    }
    return rows[0].value;
  });
}

export async function staffSellerBroadcastCount(
  client: StaffQueryClient,
  input: { actorId: string; query: string },
) {
  if (!validId(input.actorId) || !isTextWithinCodePointRange(input.query, 0, 200)) {
    throw new RangeError("SellerBroadcast staff count input is outside the supported range");
  }
  const rows = await client.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_seller_broadcast_staff_count(
      ${input.actorId}::text,
      ${input.query}::text
    ) AS value
  `;
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("SellerBroadcast staff count authority returned an invalid result");
  }
  return value as number;
}
export async function staffSellerBroadcastPage(
  client: StaffQueryClient,
  input: { actorId: string; query: string; offset: number; limit: number },
) {
  if (
    !validId(input.actorId)
    || !isTextWithinCodePointRange(input.query, 0, 200)
    || !Number.isSafeInteger(input.offset)
    || input.offset < 0
    || input.offset > 1_000_000
    || !Number.isSafeInteger(input.limit)
    || input.limit < 1
    || input.limit > 100
  ) {
    throw new RangeError("SellerBroadcast staff page input is outside the supported range");
  }
  const rows = await client.$queryRaw<unknown[]>`
    SELECT * FROM public.grainline_seller_broadcast_staff_page(
      ${input.actorId}::text,
      ${input.query}::text,
      ${input.offset}::integer,
      ${input.limit}::integer
    )
  `;
  return rows.map(checkedBroadcastRow);
}

export async function deleteStaffSellerBroadcast(
  client: StaffQueryClient,
  input: { actorId: string; broadcastId: string },
) {
  if (!validId(input.actorId) || !validId(input.broadcastId)) {
    throw new RangeError("SellerBroadcast staff delete input is outside the supported range");
  }
  const rows = await client.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_seller_broadcast_staff_delete(
      ${input.actorId}::text,
      ${input.broadcastId}::text
    ) AS value
  `;
  if (rows.length !== 1 || typeof rows[0]?.value !== "boolean") {
    throw new TypeError("SellerBroadcast staff delete authority returned an invalid result");
  }
  return rows[0].value;
}

export async function accountDeletionSellerBroadcastIds(
  client: DbUserContextTransactionClient,
  sellerProfileId: string,
) {
  if (!validId(sellerProfileId)) {
    throw new RangeError("SellerBroadcast deletion seller id is invalid");
  }
  const rows = await client.$queryRaw<Array<{ id: unknown }>>`
    SELECT * FROM public.grainline_seller_broadcast_account_deletion_ids(
      ${sellerProfileId}::text
    )
  `;
  if (rows.some((row) => !validId(row.id))) {
    throw new TypeError("SellerBroadcast deletion id authority returned an invalid row");
  }
  return rows.map((row) => row.id as string);
}

export async function cleanupAccountSellerBroadcasts(
  client: DbUserContextTransactionClient,
  sellerProfileId: string,
) {
  if (!validId(sellerProfileId)) {
    throw new RangeError("SellerBroadcast deletion seller id is invalid");
  }
  const rows = await client.$queryRaw<Array<{ value: unknown }>>`
    SELECT public.grainline_seller_broadcast_account_deletion_cleanup(
      ${sellerProfileId}::text
    ) AS value
  `;
  const value = typeof rows[0]?.value === "bigint" ? Number(rows[0].value) : rows[0]?.value;
  if (rows.length !== 1 || !Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError("SellerBroadcast deletion cleanup authority returned an invalid result");
  }
  return value as number;
}
