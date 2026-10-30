import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  type DbUserContextTransactionClient,
  withDbUserContext,
} from "@/lib/dbUserContext";

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

type SellerOwnerFollowingCountRow = {
  value: unknown;
};

type SellerFollowTargetRow = {
  sellerProfileId: unknown;
};

type SellerOwnerFollowingPageRow = {
  followId: unknown;
  followedAt: unknown;
  sellerProfileId: unknown;
  displayName: unknown;
  tagline: unknown;
  avatarImageUrl: unknown;
  city: unknown;
  state: unknown;
  vacationMode: unknown;
  vacationReturnDate: unknown;
  guildLevel: unknown;
  ownerImageUrl: unknown;
  followerCount: unknown;
  listingCount: unknown;
  latestListingId: unknown;
  latestListingTitle: unknown;
  latestListingPriceCents: unknown;
  latestListingCurrency: unknown;
  latestListingPhotoUrl: unknown;
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

export type SellerOwnerFollowing = Readonly<{
  createdAt: Date;
  sellerProfile: Readonly<{
    id: string;
    displayName: string;
    tagline: string | null;
    avatarImageUrl: string | null;
    city: string | null;
    state: string | null;
    vacationMode: boolean;
    vacationReturnDate: Date | null;
    guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
    ownerImageUrl: string | null;
    followerCount: number;
    listingCount: number;
    latestListing: Readonly<{
      id: string;
      title: string;
      priceCents: number;
      currency: string;
      photoUrl: string | null;
    }> | null;
  }>;
}>;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/.test(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableDate(value: unknown, label: string) {
  if (value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Seller owner following authority returned an invalid " + label);
  }
  return value;
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

function integerNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Follow authority returned an invalid integer count");
  }
  return value;
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

export async function sellerPublicFollowStateBatch(
  sellerProfileIds: string[],
  viewerUserId?: string,
) {
  const uniqueSellerProfileIds = [...new Set(sellerProfileIds)];
  if (uniqueSellerProfileIds.length === 0) {
    return Object.freeze([]) as readonly Readonly<SellerFollowState>[];
  }
  if (
    uniqueSellerProfileIds.length > 100
    || uniqueSellerProfileIds.some((id) => !validId(id))
  ) {
    throw new RangeError("Seller public follow-state batch is outside the supported range");
  }
  const read = async (client: SellerFollowClient) => {
    const rows = await client.$queryRaw<SellerFollowStateRow[]>`
      SELECT *
        FROM public.grainline_follow_public_state_batch(
          ${uniqueSellerProfileIds}::text[]
        )
    `;
    if (rows.length > uniqueSellerProfileIds.length) {
      throw new Error("Seller public follow-state batch returned too many rows");
    }
    const requested = new Set(uniqueSellerProfileIds);
    const seen = new Set<string>();
    return Object.freeze(rows.map((row) => {
      if (
        !validId(row.sellerProfileId)
        || !requested.has(row.sellerProfileId)
        || seen.has(row.sellerProfileId)
        || typeof row.following !== "boolean"
      ) {
        throw new Error("Seller public follow-state batch returned an invalid result");
      }
      seen.add(row.sellerProfileId);
      return Object.freeze({
        sellerProfileId: row.sellerProfileId,
        followerCount: countNumber(row.followerCount),
        following: row.following,
      }) satisfies Readonly<SellerFollowState>;
    }));
  };
  return viewerUserId
    ? withDbUserContext(viewerUserId, read)
    : read(prisma);
}

async function readSellerOwnerFollowingCount(client: SellerFollowClient) {
  const rows = await client.$queryRaw<SellerOwnerFollowingCountRow[]>`
    SELECT * FROM public.grainline_seller_owner_following_count()
  `;
  if (rows.length !== 1) {
    throw new Error("Seller owner following-count authority returned an invalid result");
  }
  return countNumber(rows[0].value);
}

export function sellerOwnerFollowingCount(actorUserId: string) {
  return withDbUserContext(actorUserId, readSellerOwnerFollowingCount);
}

export function ownerRawFollowCount(actorUserId: string) {
  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<SellerOwnerFollowingCountRow[]>`
      SELECT * FROM public.grainline_follow_owner_outgoing_count()
    `;
    if (rows.length !== 1) {
      throw new Error("Follow owner outgoing-count authority returned an invalid result");
    }
    return countNumber(rows[0].value);
  });
}

export function sellerOwnerFollowerCount(actorUserId: string) {
  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<SellerOwnerFollowingCountRow[]>`
      SELECT * FROM public.grainline_follow_seller_owner_incoming_count()
    `;
    if (rows.length !== 1) {
      throw new Error("Seller owner follower-count authority returned an invalid result");
    }
    return countNumber(rows[0].value);
  });
}

export function ownerFollowedSellerIds(actorUserId: string, limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError("Owner followed-seller limit is outside the supported range");
  }
  return withDbUserContext(actorUserId, async (client) => {
    const rows = await client.$queryRaw<SellerFollowTargetRow[]>`
      SELECT * FROM public.grainline_follow_owner_target_ids(${limit}::integer)
    `;
    const sellerProfileIds = rows.map((row) => row.sellerProfileId);
    if (
      rows.length > limit
      || sellerProfileIds.some((id) => !validId(id))
      || new Set(sellerProfileIds).size !== sellerProfileIds.length
    ) {
      throw new Error("Owner followed-seller authority returned an invalid result");
    }
    return Object.freeze(sellerProfileIds as string[]);
  });
}

export async function cleanupFollowsForAccountDeletion(
  client: DbUserContextTransactionClient,
  input: {
    sideEffectId: string;
    expectedUserId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_follow_account_deletion_cleanup(
      ${input.sideEffectId}::text,
      ${input.expectedUserId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid
    ) AS value
  `;
  if (rows.length !== 1) {
    throw new Error("Follow account-deletion authority returned invalid cardinality");
  }
  return integerNumber(rows[0].value);
}

async function readSellerOwnerFollowingPage(
  client: SellerFollowClient,
  limit: number,
  offset: number,
) {
  const rows = await client.$queryRaw<SellerOwnerFollowingPageRow[]>`
    SELECT *
      FROM public.grainline_seller_owner_following_page(
        ${limit}::integer,
        ${offset}::integer
      )
  `;
  const follows = rows.map((row) => {
    if (
      !validId(row.followId)
      || !(row.followedAt instanceof Date)
      || Number.isNaN(row.followedAt.getTime())
      || !validId(row.sellerProfileId)
      || typeof row.displayName !== "string"
      || !row.displayName
      || !nullableString(row.tagline)
      || !nullableString(row.avatarImageUrl)
      || !nullableString(row.city)
      || !nullableString(row.state)
      || typeof row.vacationMode !== "boolean"
      || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
      || !nullableString(row.ownerImageUrl)
      || !nullableString(row.latestListingId)
      || !nullableString(row.latestListingTitle)
      || (
        row.latestListingPriceCents !== null
        && (!Number.isSafeInteger(row.latestListingPriceCents)
          || Number(row.latestListingPriceCents) < 0)
      )
      || !nullableString(row.latestListingCurrency)
      || !nullableString(row.latestListingPhotoUrl)
    ) {
      throw new Error("Seller owner following-page authority returned an invalid result");
    }
    const latestListingPresent = row.latestListingId !== null;
    if (
      latestListingPresent
      !== (
        row.latestListingTitle !== null
        && row.latestListingPriceCents !== null
        && row.latestListingCurrency !== null
      )
      || (!latestListingPresent && row.latestListingPhotoUrl !== null)
    ) {
      throw new Error("Seller owner following-page authority returned a partial listing");
    }
    return Object.freeze({
      createdAt: row.followedAt,
      sellerProfile: Object.freeze({
        id: row.sellerProfileId,
        displayName: row.displayName,
        tagline: row.tagline,
        avatarImageUrl: row.avatarImageUrl,
        city: row.city,
        state: row.state,
        vacationMode: row.vacationMode,
        vacationReturnDate: nullableDate(row.vacationReturnDate, "vacation date"),
        guildLevel: row.guildLevel as SellerOwnerFollowing["sellerProfile"]["guildLevel"],
        ownerImageUrl: row.ownerImageUrl,
        followerCount: countNumber(row.followerCount),
        listingCount: countNumber(row.listingCount),
        latestListing: latestListingPresent
          ? Object.freeze({
              id: row.latestListingId!,
              title: row.latestListingTitle!,
              priceCents: Number(row.latestListingPriceCents),
              currency: row.latestListingCurrency!,
              photoUrl: row.latestListingPhotoUrl,
            })
          : null,
      }),
    });
  });
  if (
    follows.length > limit
    || new Set(follows.map(({ sellerProfile }) => sellerProfile.id)).size !== follows.length
  ) {
    throw new Error("Seller owner following-page authority returned invalid cardinality");
  }
  return Object.freeze(follows);
}

export function sellerOwnerFollowingPage(
  actorUserId: string,
  limit: number,
  offset: number,
) {
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 20
    || !Number.isSafeInteger(offset)
    || offset < 0
    || offset > 19980
  ) {
    throw new RangeError("Seller owner following page is outside the supported range");
  }
  return withDbUserContext(actorUserId, (client) =>
    readSellerOwnerFollowingPage(client, limit, offset));
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
