import type { Prisma } from "@prisma/client";

type SellerAccountDeletionMediaClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type SellerAccountDeletionMediaRow = {
  url: unknown;
};

/**
 * Returns public seller/listing media owned by the active LOCAL_ANONYMIZE
 * claim. The database derives the user from the generation-bound claim.
 */
export async function sellerAccountDeletionPublicMediaUrls(
  client: SellerAccountDeletionMediaClient,
  input: {
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  const rows = await client.$queryRaw<SellerAccountDeletionMediaRow[]>`
    SELECT url
      FROM public.grainline_seller_account_deletion_public_media_urls(
        ${input.sideEffectId}::text,
        ${input.claimGeneration}::bigint,
        ${input.claimToken}::uuid
      )
  `;
  if (rows.some((row) => typeof row.url !== "string" || row.url.length === 0)) {
    throw new Error("Seller account-deletion media authority returned an invalid result");
  }
  return rows.map((row) => row.url as string);
}
