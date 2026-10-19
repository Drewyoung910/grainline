import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withDbUserContext } from "@/lib/dbUserContext";

type SellerFollowClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type SellerFollowStateRow = {
  sellerProfileId: unknown;
  followerCount: unknown;
  following: unknown;
};

type SellerFollowCreateRow = {
  resultStatus: unknown;
  ownerUserId: unknown;
  created: unknown;
  followerCount: unknown;
};

type SellerFollowDeleteRow = {
  resultStatus: unknown;
  followerCount: unknown;
};

export type SellerFollowState = {
  sellerProfileId: string;
  followerCount: number;
  following: boolean;
};

export type SellerFollowCreateResult =
  | { status: "NOT_FOUND" | "SELF" | "BLOCKED" }
  | {
      status: "OK";
      ownerUserId: string;
      created: boolean;
      followerCount: number;
    };

export type SellerFollowDeleteResult =
  | { status: "NOT_FOUND" }
  | { status: "OK"; followerCount: number };

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/.test(value);
}

function countNumber(value: unknown) {
  if (
    typeof value !== "bigint"
    || value < 0n
    || value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Seller follow authority returned an invalid count");
  }
  return Number(value);
}

async function readSellerPublicFollowState(
  client: SellerFollowClient,
  sellerProfileId: string,
) {
  const rows = await client.$queryRaw<SellerFollowStateRow[]>`
    SELECT *
      FROM public.grainline_seller_public_follow_state(${sellerProfileId}::text)
  `;
  if (rows.length > 1) {
    throw new Error("Seller public follow-state authority returned too many rows");
  }
  const row = rows[0];
  if (!row) return null;
  if (!validId(row.sellerProfileId) || typeof row.following !== "boolean") {
    throw new Error("Seller public follow-state authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId: row.sellerProfileId,
    followerCount: countNumber(row.followerCount),
    following: row.following,
  }) satisfies Readonly<SellerFollowState>;
}

export function sellerPublicFollowState(
  sellerProfileId: string,
  viewerUserId?: string,
) {
  if (!validId(sellerProfileId)) return Promise.resolve(null);
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicFollowState(client, sellerProfileId));
  }
  return readSellerPublicFollowState(prisma, sellerProfileId);
}

async function readSellerFollowCreate(
  client: SellerFollowClient,
  sellerProfileId: string,
  followId: string,
): Promise<SellerFollowCreateResult> {
  const rows = await client.$queryRaw<SellerFollowCreateRow[]>`
    SELECT *
      FROM public.grainline_seller_public_follow_create(
        ${sellerProfileId}::text,
        ${followId}::text
      )
  `;
  const row = rows[0];
  if (rows.length !== 1 || typeof row?.resultStatus !== "string") {
    throw new Error("Seller public follow-create authority returned an invalid result");
  }
  if (["NOT_FOUND", "SELF", "BLOCKED"].includes(row.resultStatus)) {
    return { status: row.resultStatus as "NOT_FOUND" | "SELF" | "BLOCKED" };
  }
  if (
    row.resultStatus !== "OK"
    || !validId(row.ownerUserId)
    || typeof row.created !== "boolean"
  ) {
    throw new Error("Seller public follow-create authority returned an invalid result");
  }
  return Object.freeze({
    status: "OK" as const,
    ownerUserId: row.ownerUserId,
    created: row.created,
    followerCount: countNumber(row.followerCount),
  });
}

export function createSellerFollow(actorUserId: string, sellerProfileId: string) {
  if (!validId(sellerProfileId)) {
    return Promise.resolve({ status: "NOT_FOUND" as const });
  }
  return withDbUserContext(actorUserId, (client) =>
    readSellerFollowCreate(client, sellerProfileId, randomUUID()), {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}

async function readSellerFollowDelete(
  client: SellerFollowClient,
  sellerProfileId: string,
): Promise<SellerFollowDeleteResult> {
  const rows = await client.$queryRaw<SellerFollowDeleteRow[]>`
    SELECT *
      FROM public.grainline_seller_public_follow_delete(${sellerProfileId}::text)
  `;
  const row = rows[0];
  if (rows.length !== 1 || typeof row?.resultStatus !== "string") {
    throw new Error("Seller public follow-delete authority returned an invalid result");
  }
  if (row.resultStatus === "NOT_FOUND") return { status: "NOT_FOUND" };
  if (row.resultStatus !== "OK") {
    throw new Error("Seller public follow-delete authority returned an invalid result");
  }
  return Object.freeze({
    status: "OK" as const,
    followerCount: countNumber(row.followerCount),
  });
}

export function deleteSellerFollow(actorUserId: string, sellerProfileId: string) {
  if (!validId(sellerProfileId)) {
    return Promise.resolve({ status: "NOT_FOUND" as const });
  }
  return withDbUserContext(actorUserId, (client) =>
    readSellerFollowDelete(client, sellerProfileId));
}
