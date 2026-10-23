import { withDbUserContext, type DbUserContextTransactionClient } from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type SellerSavedListingCountRow = {
  value: unknown;
};

type SellerSavedListingPageRow = {
  savedAt: unknown;
  listingId: unknown;
  title: unknown;
  priceCents: unknown;
  currency: unknown;
  status: unknown;
  listingType: unknown;
  stockQuantity: unknown;
  sellerProfileId: unknown;
  displayName: unknown;
  avatarImageUrl: unknown;
  ownerImageUrl: unknown;
  guildLevel: unknown;
  city: unknown;
  state: unknown;
  acceptingNewOrders: unknown;
  photoUrl: unknown;
  photoAltText: unknown;
};

export type SellerOwnerSavedListing = Readonly<{
  createdAt: Date;
  listing: Readonly<{
    id: string;
    title: string;
    priceCents: number;
    currency: string;
    status: "ACTIVE" | "SOLD_OUT";
    listingType: "MADE_TO_ORDER" | "IN_STOCK";
    stockQuantity: number | null;
    seller: Readonly<{
      id: string;
      displayName: string;
      avatarImageUrl: string | null;
      ownerImageUrl: string | null;
      guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
      city: string | null;
      state: string | null;
      acceptingNewOrders: boolean;
    }>;
    photos: readonly Readonly<{
      url: string;
      altText: string | null;
    }>[];
  }>;
}>;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/.test(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validInteger(value: unknown, minimum: number): value is number;
function validInteger(value: unknown, minimum: number, nullable: true): value is number | null;
function validInteger(value: unknown, minimum: number, nullable = false): value is number | null {
  return (nullable && value === null)
    || (Number.isSafeInteger(value) && Number(value) >= minimum);
}

function countNumber(value: unknown) {
  if (
    typeof value !== "bigint"
    || value < 0n
    || value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Seller saved-listing authority returned an invalid count");
  }
  return Number(value);
}

async function readSellerOwnerSavedListingCount(client: DbUserContextTransactionClient) {
  const rows = await client.$queryRaw<SellerSavedListingCountRow[]>`
    SELECT * FROM public.grainline_seller_owner_saved_listing_count()
  `;
  if (rows.length !== 1) {
    throw new Error("Seller saved-listing count authority returned invalid cardinality");
  }
  return countNumber(rows[0].value);
}

export function sellerOwnerSavedListingCount(actorUserId: string) {
  return withDbUserContext(actorUserId, readSellerOwnerSavedListingCount);
}

async function readSellerOwnerSavedListingPage(
  client: DbUserContextTransactionClient,
  limit: number,
  offset: number,
) {
  const rows = await client.$queryRaw<SellerSavedListingPageRow[]>`
    SELECT *
      FROM public.grainline_seller_owner_saved_listing_page(
        ${limit}::integer,
        ${offset}::integer
      )
  `;
  const savedListings = rows.map((row) => {
    if (
      !(row.savedAt instanceof Date)
      || Number.isNaN(row.savedAt.getTime())
      || !validId(row.listingId)
      || !isTextWithinCodePointRange(row.title, 1, 150)
      || !validInteger(row.priceCents, 0)
      || typeof row.currency !== "string"
      || row.currency.length !== 3
      || !["ACTIVE", "SOLD_OUT"].includes(String(row.status))
      || !["MADE_TO_ORDER", "IN_STOCK"].includes(String(row.listingType))
      || !validInteger(row.stockQuantity, 0, true)
      || !validId(row.sellerProfileId)
      || !isTextWithinCodePointRange(row.displayName, 1, 100)
      || !nullableString(row.avatarImageUrl)
      || !nullableString(row.ownerImageUrl)
      || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
      || !nullableString(row.city)
      || !nullableString(row.state)
      || typeof row.acceptingNewOrders !== "boolean"
      || !nullableString(row.photoUrl)
      || !nullableString(row.photoAltText)
      || (row.photoUrl === null && row.photoAltText !== null)
    ) {
      throw new Error("Seller saved-listing page authority returned an invalid result");
    }
    return Object.freeze({
      createdAt: row.savedAt,
      listing: Object.freeze({
        id: row.listingId,
        title: row.title,
        priceCents: row.priceCents,
        currency: row.currency,
        status: row.status as SellerOwnerSavedListing["listing"]["status"],
        listingType: row.listingType as SellerOwnerSavedListing["listing"]["listingType"],
        stockQuantity: row.stockQuantity,
        seller: Object.freeze({
          id: row.sellerProfileId,
          displayName: row.displayName,
          avatarImageUrl: row.avatarImageUrl,
          ownerImageUrl: row.ownerImageUrl,
          guildLevel: row.guildLevel as SellerOwnerSavedListing["listing"]["seller"]["guildLevel"],
          city: row.city,
          state: row.state,
          acceptingNewOrders: row.acceptingNewOrders,
        }),
        photos: row.photoUrl === null
          ? Object.freeze([])
          : Object.freeze([Object.freeze({
              url: row.photoUrl,
              altText: row.photoAltText,
            })]),
      }),
    }) satisfies SellerOwnerSavedListing;
  });
  if (
    savedListings.length > limit
    || new Set(savedListings.map(({ listing }) => listing.id)).size !== savedListings.length
  ) {
    throw new Error("Seller saved-listing page authority returned invalid cardinality");
  }
  return Object.freeze(savedListings);
}

export function sellerOwnerSavedListingPage(
  actorUserId: string,
  limit: number,
  offset: number,
) {
  if (
    !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 24
    || !Number.isSafeInteger(offset)
    || offset < 0
    || offset > 23976
  ) {
    throw new RangeError("Seller saved-listing page is outside the supported range");
  }
  return withDbUserContext(actorUserId, (client) =>
    readSellerOwnerSavedListingPage(client, limit, offset));
}
