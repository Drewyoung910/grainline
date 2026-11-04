import type { Prisma } from "@prisma/client";

type ListingAccountDeletionClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type ListingAccountDeletionRow = {
  seller_profile_id: unknown;
  photos_deleted: unknown;
  variant_groups_deleted: unknown;
  listings_redacted: unknown;
};

function validCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
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
    || !validCount(row.photos_deleted)
    || !validCount(row.variant_groups_deleted)
    || !validCount(row.listings_redacted)
  ) {
    throw new Error("Listing account-deletion authority returned an invalid result");
  }
  return Object.freeze({
    sellerProfileId: row.seller_profile_id,
    photosDeleted: row.photos_deleted,
    variantGroupsDeleted: row.variant_groups_deleted,
    listingsRedacted: row.listings_redacted,
  });
}
