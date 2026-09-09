import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import type { BanOpenOrderSnapshot } from "@/lib/banAuditMetadata";

type BanReviewClient = Pick<Prisma.TransactionClient, "$queryRaw"> | Pick<typeof prisma, "$queryRaw">;

type FlaggedOrderRow = {
  orderId: unknown;
  buyerId: unknown;
  previousReviewNeeded: unknown;
  previousReviewNoteHash: unknown;
  previousReviewNoteLength: unknown;
  addedReviewNote: unknown;
};

const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_BAN_ORDER_SNAPSHOTS = 5_000;

function normalizedRows(rows: FlaggedOrderRow[]): BanOpenOrderSnapshot[] {
  if (rows.length > MAX_BAN_ORDER_SNAPSHOTS) {
    throw new TypeError("Ban Order review authority returned too many rows");
  }
  return rows.map((row) => {
    if (
      typeof row.orderId !== "string"
      || !ORDER_ID_PATTERN.test(row.orderId)
      || (row.buyerId !== null && typeof row.buyerId !== "string")
      || typeof row.previousReviewNeeded !== "boolean"
      || (
        row.previousReviewNoteHash !== null
        && (
          typeof row.previousReviewNoteHash !== "string"
          || !SHA256_PATTERN.test(row.previousReviewNoteHash)
        )
      )
      || typeof row.previousReviewNoteLength !== "number"
      || !Number.isSafeInteger(row.previousReviewNoteLength)
      || row.previousReviewNoteLength < 0
      || row.previousReviewNoteLength > 10_000
      || typeof row.addedReviewNote !== "boolean"
    ) {
      throw new TypeError("Ban Order review authority returned an invalid row");
    }
    return {
      id: row.orderId,
      buyerId: row.buyerId,
      previousReviewNeeded: row.previousReviewNeeded,
      previousReviewNoteHash: row.previousReviewNoteHash,
      previousReviewNoteLength: row.previousReviewNoteLength,
      addedReviewNote: row.addedReviewNote,
    };
  });
}

export async function flagBannedSellerOpenOrders(
  actorUserIdInput: string,
  targetUserIdInput: string,
  client: BanReviewClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const targetUserId = normalizeDbUserContextUserId(targetUserIdInput);
  const rows = await client.$queryRaw<FlaggedOrderRow[]>`
    SELECT
      flagged.order_id AS "orderId",
      flagged.buyer_id AS "buyerId",
      flagged.previous_review_needed AS "previousReviewNeeded",
      flagged.previous_review_note_hash AS "previousReviewNoteHash",
      flagged.previous_review_note_length AS "previousReviewNoteLength",
      flagged.added_review_note AS "addedReviewNote"
    FROM public.grainline_order_flag_banned_seller_open_orders(
      ${actorUserId}::text,
      ${targetUserId}::text
    ) AS flagged
  `;
  return normalizedRows(rows);
}

export async function restoreBannedSellerOrderReviews(
  actorUserIdInput: string,
  targetUserIdInput: string,
  snapshots: BanOpenOrderSnapshot[],
  client: BanReviewClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const targetUserId = normalizeDbUserContextUserId(targetUserIdInput);
  if (snapshots.length > MAX_BAN_ORDER_SNAPSHOTS) {
    throw new TypeError("Ban Order review snapshot set is too large");
  }
  const payload = snapshots.map((snapshot) => ({
    id: snapshot.id,
    previousReviewNeeded: snapshot.previousReviewNeeded,
    previousReviewNoteHash: snapshot.previousReviewNoteHash,
    previousReviewNoteLength: snapshot.previousReviewNoteLength,
    ...(snapshot.addedReviewNote === undefined
      ? {}
      : { addedReviewNote: snapshot.addedReviewNote }),
  }));
  const rows = await client.$queryRaw<Array<{ restoredCount: unknown }>>`
    SELECT public.grainline_order_restore_banned_seller_reviews(
      ${actorUserId}::text,
      ${targetUserId}::text,
      ${JSON.stringify(payload)}::jsonb
    ) AS "restoredCount"
  `;
  if (
    rows.length !== 1
    || typeof rows[0]?.restoredCount !== "number"
    || !Number.isSafeInteger(rows[0].restoredCount)
    || rows[0].restoredCount < 0
    || rows[0].restoredCount > snapshots.length
  ) {
    throw new TypeError("Ban Order review restore returned an invalid count");
  }
  return rows[0].restoredCount;
}
