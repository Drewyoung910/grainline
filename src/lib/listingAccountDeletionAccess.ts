import type { Prisma } from "@prisma/client";

type ListingAccountDeletionClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type ListingAccountDeletionRow = {
  seller_profile_id: unknown;
  listing_ids: unknown;
  photos_deleted: unknown;
  variant_groups_deleted: unknown;
  listings_redacted: unknown;
};

function validCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validListingIds(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.every((listingId) => (
      typeof listingId === "string"
      && /^[A-Za-z0-9._:-]{1,191}$/u.test(listingId)
    ))
    && new Set(value).size === value.length;
}

export async function redactListingsForAccountDeletion(
  client: ListingAccountDeletionClient,
  input: {
    sideEffectId: string;
    expectedUserId: string;
    expectedSellerProfileId: string;
    claimGeneration: bigint;
    claimToken: string;
    archivedAt: Date;
  },
) {
  const rows = await client.$queryRaw<ListingAccountDeletionRow[]>`
    SELECT *
      FROM public.grainline_listing_account_deletion_redact(
        ${input.sideEffectId}::text,
        ${input.expectedUserId}::text,
        ${input.claimGeneration}::bigint,
        ${input.claimToken}::uuid,
        ${input.archivedAt}::timestamp
      )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || row?.seller_profile_id !== input.expectedSellerProfileId
    || !validListingIds(row.listing_ids)
    || !validCount(row.photos_deleted)
    || !validCount(row.variant_groups_deleted)
    || !validCount(row.listings_redacted)
  ) {
    throw new Error("Listing account-deletion authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId: row.seller_profile_id,
    listingIds: Object.freeze([...row.listing_ids]),
    photosDeleted: row.photos_deleted,
    variantGroupsDeleted: row.variant_groups_deleted,
    listingsRedacted: row.listings_redacted,
  });
}
