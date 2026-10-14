import type { Prisma } from "@prisma/client";

type SellerAccountDeletionClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/** Compatibility boundary for account-deletion mutations of private seller data. */
export async function pauseSellerForAccountDeletion(
  client: SellerAccountDeletionClient,
  input: {
    userId: string;
    stripeAccountId?: string;
    sideEffectId?: string;
    claimGeneration?: bigint;
    claimToken?: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ paused: boolean }>>`
    SELECT public.grainline_seller_account_deletion_pause(
      ${input.userId}::text,
      ${input.stripeAccountId ?? null}::text,
      ${input.sideEffectId ?? null}::text,
      ${input.claimGeneration ?? null}::bigint,
      ${input.claimToken ?? null}::uuid
    ) AS paused
  `;
  if (rows.length !== 1 || typeof rows[0]?.paused !== "boolean") {
    throw new Error("Seller account-deletion pause authority returned an invalid result");
  }
  if (!rows[0].paused && input.stripeAccountId) {
    throw new Error("Account deletion seller provider identity changed");
  }
  return { count: rows[0].paused ? 1 : 0 };
}

export async function anonymizeSellerForAccountDeletion(
  client: SellerAccountDeletionClient,
  input: {
    sellerProfileId: string;
    userId: string;
    stripeRejectSucceeded: boolean;
    stripeAccountId: string | null;
    stripeAccountVersion: string | null;
    stripeControllerType: string | null;
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT public.grainline_seller_account_deletion_anonymize(
      ${input.sellerProfileId}::text,
      ${input.userId}::text,
      ${input.stripeRejectSucceeded}::boolean,
      ${input.stripeAccountId}::text,
      ${input.stripeAccountVersion}::text,
      ${input.stripeControllerType}::text,
      ${input.sideEffectId}::text,
      ${input.claimGeneration}::bigint,
      ${input.claimToken}::uuid
    ) AS id
  `;
  if (rows.length !== 1 || rows[0]?.id !== input.sellerProfileId) {
    throw new Error("Seller account-deletion anonymize authority returned an invalid result");
  }
}
