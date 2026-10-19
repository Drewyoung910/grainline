import type { Prisma } from "@prisma/client";
import { withDbUserContext } from "@/lib/dbUserContext";

type SellerProfileOwnerClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type SellerOwnerAccountSummaryRow = {
  sellerProfileId: unknown;
  avatarImageUrl: unknown;
  activeListingCount: unknown;
};

type SellerOwnerCoreRow = {
  sellerProfileId: unknown;
  displayName: unknown;
  createdAtEpochMillis: unknown;
  chargesEnabled: unknown;
  vacationMode: unknown;
};

type SellerOwnerBlogEditorRow = {
  sellerProfileId: unknown;
  listingId: unknown;
  listingTitle: unknown;
};

type SellerOwnerListingReviewRow = {
  sellerProfileId: unknown;
  displayName: unknown;
  totalListingCount: unknown;
};

type SellerOwnerListingMetroSourceRow = {
  sellerProfileId: unknown;
  lat: unknown;
  lng: unknown;
};

export type SellerOwnerAccountSummary = {
  sellerProfileId: string;
  avatarImageUrl: string | null;
  activeListingCount: number;
};

export type SellerOwnerCore = {
  sellerProfileId: string;
  displayName: string;
  createdAt: Date;
  chargesEnabled: boolean;
  vacationMode: boolean;
};

export type SellerOwnerBlogEditor = {
  sellerProfileId: string;
  listings: ReadonlyArray<Readonly<{
    id: string;
    title: string;
  }>>;
};

export type SellerOwnerListingReview = {
  sellerProfileId: string;
  displayName: string;
  totalListingCount: number;
};

export type SellerOwnerListingMetroSource = {
  sellerProfileId: string;
  lat: number | null;
  lng: number | null;
};

async function readSellerOwnerListingMetroSource(
  client: SellerProfileOwnerClient,
  sellerProfileId: string,
) {
  const rows = await client.$queryRaw<SellerOwnerListingMetroSourceRow[]>`
    SELECT *
      FROM public.grainline_seller_owner_listing_metro_source(
        ${sellerProfileId}::text
      )
  `;
  if (rows.length > 1) {
    throw new Error("Seller owner listing-metro authority returned too many rows");
  }
  const row = rows[0];
  if (!row) return null;
  const coordinatesAreNull = row.lat === null && row.lng === null;
  const coordinatesAreValid = typeof row.lat === "number"
    && Number.isFinite(row.lat)
    && row.lat >= -90
    && row.lat <= 90
    && typeof row.lng === "number"
    && Number.isFinite(row.lng)
    && row.lng >= -180
    && row.lng <= 180;
  if (
    row.sellerProfileId !== sellerProfileId
    || !/^[A-Za-z0-9._:-]{1,191}$/.test(sellerProfileId)
    || (!coordinatesAreNull && !coordinatesAreValid)
  ) {
    throw new Error("Seller owner listing-metro authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId,
    lat: row.lat as number | null,
    lng: row.lng as number | null,
  }) satisfies Readonly<SellerOwnerListingMetroSource>;
}

export function sellerOwnerListingMetroSource(
  userId: string,
  sellerProfileId: string,
) {
  return withDbUserContext(
    userId,
    (client) => readSellerOwnerListingMetroSource(client, sellerProfileId),
  );
}

async function readSellerOwnerListingReview(client: SellerProfileOwnerClient) {
  const rows = await client.$queryRaw<SellerOwnerListingReviewRow[]>`
    SELECT * FROM public.grainline_seller_owner_listing_review()
  `;
  if (rows.length > 1) {
    throw new Error("Seller owner listing-review authority returned too many rows");
  }
  const row = rows[0];
  if (!row) return null;
  if (
    typeof row.sellerProfileId !== "string"
    || !/^[A-Za-z0-9._:-]{1,191}$/.test(row.sellerProfileId)
    || typeof row.displayName !== "string"
    || row.displayName.length < 1
    || row.displayName.length > 100
    || typeof row.totalListingCount !== "bigint"
    || row.totalListingCount < 0n
    || row.totalListingCount > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Seller owner listing-review authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId: row.sellerProfileId,
    displayName: row.displayName,
    totalListingCount: Number(row.totalListingCount),
  }) satisfies Readonly<SellerOwnerListingReview>;
}

export function sellerOwnerListingReview(userId: string) {
  return withDbUserContext(userId, readSellerOwnerListingReview);
}

async function readSellerOwnerBlogEditor(client: SellerProfileOwnerClient) {
  const rows = await client.$queryRaw<SellerOwnerBlogEditorRow[]>`
    SELECT * FROM public.grainline_seller_owner_blog_editor()
  `;
  if (rows.length === 0) return null;

  const sellerProfileId = rows[0]?.sellerProfileId;
  if (
    typeof sellerProfileId !== "string"
    || !/^[A-Za-z0-9._:-]{1,191}$/.test(sellerProfileId)
  ) {
    throw new Error("Seller owner blog-editor authority returned an invalid seller");
  }

  const listingIds = new Set<string>();
  const listings = rows.flatMap((row) => {
    if (row.sellerProfileId !== sellerProfileId) {
      throw new Error("Seller owner blog-editor authority returned mixed sellers");
    }
    if (row.listingId === null && row.listingTitle === null) return [];
    if (
      typeof row.listingId !== "string"
      || !/^[A-Za-z0-9._:-]{1,191}$/.test(row.listingId)
      || typeof row.listingTitle !== "string"
      || row.listingTitle.length < 1
      || row.listingTitle.length > 150
      || listingIds.has(row.listingId)
    ) {
      throw new Error("Seller owner blog-editor authority returned an invalid listing");
    }
    listingIds.add(row.listingId);
    return [Object.freeze({ id: row.listingId, title: row.listingTitle })];
  });
  if (rows.length > 1 && listings.length !== rows.length) {
    throw new Error("Seller owner blog-editor authority returned an invalid empty listing row");
  }
  return Object.freeze({
    sellerProfileId,
    listings: Object.freeze(listings),
  }) satisfies Readonly<SellerOwnerBlogEditor>;
}

export function sellerOwnerBlogEditor(userId: string) {
  return withDbUserContext(userId, readSellerOwnerBlogEditor);
}

async function readSellerOwnerCore(client: SellerProfileOwnerClient) {
  const rows = await client.$queryRaw<SellerOwnerCoreRow[]>`
    SELECT * FROM public.grainline_seller_owner_core()
  `;
  if (rows.length > 1) {
    throw new Error("Seller owner core authority returned too many rows");
  }
  const row = rows[0];
  if (!row) return null;
  if (
    typeof row.sellerProfileId !== "string"
    || !/^[A-Za-z0-9._:-]{1,191}$/.test(row.sellerProfileId)
    || typeof row.displayName !== "string"
    || row.displayName.length < 1
    || row.displayName.length > 100
    || typeof row.createdAtEpochMillis !== "bigint"
    || row.createdAtEpochMillis < 0n
    || row.createdAtEpochMillis > 253402300799999n
    || typeof row.chargesEnabled !== "boolean"
    || typeof row.vacationMode !== "boolean"
  ) {
    throw new Error("Seller owner core authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId: row.sellerProfileId,
    displayName: row.displayName,
    createdAt: new Date(Number(row.createdAtEpochMillis)),
    chargesEnabled: row.chargesEnabled,
    vacationMode: row.vacationMode,
  }) satisfies Readonly<SellerOwnerCore>;
}

export function sellerOwnerCore(userId: string) {
  return withDbUserContext(userId, readSellerOwnerCore);
}

async function readSellerOwnerAccountSummary(client: SellerProfileOwnerClient) {
  const rows = await client.$queryRaw<SellerOwnerAccountSummaryRow[]>`
    SELECT * FROM public.grainline_seller_owner_account_summary()
  `;
  if (rows.length > 1) {
    throw new Error("Seller owner account-summary authority returned too many rows");
  }
  const row = rows[0];
  if (!row) return null;
  if (
    typeof row.sellerProfileId !== "string"
    || !/^[A-Za-z0-9._:-]{1,191}$/.test(row.sellerProfileId)
    || (row.avatarImageUrl !== null && typeof row.avatarImageUrl !== "string")
    || typeof row.activeListingCount !== "bigint"
    || row.activeListingCount < 0n
    || row.activeListingCount > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Seller owner account-summary authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId: row.sellerProfileId,
    avatarImageUrl: row.avatarImageUrl,
    activeListingCount: Number(row.activeListingCount),
  }) satisfies Readonly<SellerOwnerAccountSummary>;
}

export function sellerOwnerAccountSummary(userId: string) {
  return withDbUserContext(userId, readSellerOwnerAccountSummary);
}
