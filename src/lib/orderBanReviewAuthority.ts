import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import type { BanOpenOrderSnapshot } from "@/lib/banAuditMetadata";

type BanReviewClient = Pick<Prisma.TransactionClient, "$queryRaw">;
type StaffCapabilityClient = Pick<PrismaClient, "$queryRaw">;
type BanReviewOperation = "BAN_REVIEW_FLAG" | "BAN_REVIEW_RESTORE";

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
const CAPABILITY_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_BAN_ORDER_SNAPSHOTS = 5_000;

function capabilityId(value: string) {
  if (!CAPABILITY_ID_PATTERN.test(value)) {
    throw new TypeError("Ban Order review capability id is invalid");
  }
  return value;
}

function snapshotPayload(snapshots: BanOpenOrderSnapshot[]) {
  if (snapshots.length > MAX_BAN_ORDER_SNAPSHOTS) {
    throw new TypeError("Ban Order review snapshot set is too large");
  }
  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    previousReviewNeeded: snapshot.previousReviewNeeded,
    previousReviewNoteHash: snapshot.previousReviewNoteHash,
    previousReviewNoteLength: snapshot.previousReviewNoteLength,
    ...(snapshot.addedReviewNote === undefined
      ? {}
      : { addedReviewNote: snapshot.addedReviewNote }),
  }));
}

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

export async function mintBanReviewCapability(
  actorUserIdInput: string,
  targetUserIdInput: string,
  operation: BanReviewOperation,
  snapshots: BanOpenOrderSnapshot[] | null,
  client: StaffCapabilityClient,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const targetUserId = normalizeDbUserContextUserId(targetUserIdInput);
  if (operation === "BAN_REVIEW_RESTORE" && snapshots === null) {
    throw new TypeError("Ban Order restore capability requires snapshots");
  }
  const payload = operation === "BAN_REVIEW_RESTORE"
    ? snapshotPayload(snapshots ?? [])
    : null;
  if (operation === "BAN_REVIEW_FLAG" && snapshots !== null) {
    throw new TypeError("Ban Order flag capability must not include snapshots");
  }
  const rows = await client.$queryRaw<Array<{ capabilityId: unknown }>>`
    SELECT public.grainline_order_staff_capability_mint(
      ${actorUserId}::text,
      ${targetUserId}::text,
      ${operation}::text,
      ${payload === null ? null : JSON.stringify(payload)}::jsonb
    ) AS "capabilityId"
  `;
  if (
    rows.length !== 1
    || typeof rows[0]?.capabilityId !== "string"
  ) {
    throw new TypeError("Ban Order capability mint returned an invalid result");
  }
  return capabilityId(rows[0].capabilityId);
}

export async function flagBannedSellerOpenOrders(
  capabilityIdInput: string,
  targetUserIdInput: string,
  client: BanReviewClient,
) {
  const normalizedCapabilityId = capabilityId(capabilityIdInput);
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
      ${normalizedCapabilityId}::text,
      ${targetUserId}::text
    ) AS flagged
  `;
  return normalizedRows(rows);
}

export async function restoreBannedSellerOrderReviews(
  capabilityIdInput: string,
  targetUserIdInput: string,
  snapshots: BanOpenOrderSnapshot[],
  client: BanReviewClient,
) {
  const normalizedCapabilityId = capabilityId(capabilityIdInput);
  const targetUserId = normalizeDbUserContextUserId(targetUserIdInput);
  const payload = snapshotPayload(snapshots);
  const rows = await client.$queryRaw<Array<{ restoredCount: unknown }>>`
    SELECT public.grainline_order_restore_banned_seller_reviews(
      ${normalizedCapabilityId}::text,
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
