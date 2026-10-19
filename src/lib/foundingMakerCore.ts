import { Prisma, PrismaClient } from "@prisma/client";

export const FOUNDING_MAKER_CAP = 250;

export type FoundingMakerClient = Pick<
  PrismaClient,
  "$queryRaw"
>;

/**
 * Shared allocator for Founding Maker grants.
 *
 * FoundingMakerGrant is the durable source of issued numbers. SellerProfile
 * keeps the denormalized public badge fields, but number allocation must not
 * depend on live SellerProfile rows or a future hard delete could recycle the
 * highest deleted number.
 */
export async function maybeGrantFoundingMakerWithClient(
  client: FoundingMakerClient,
  sellerProfileId: string,
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ granted: unknown }>>(Prisma.sql`
    SELECT public.grainline_seller_service_founding_maker_grant(
      ${sellerProfileId}
    ) AS granted
  `);
  if (rows.length !== 1 || typeof rows[0].granted !== "boolean") {
    throw new Error("Founding Maker grant authority returned an invalid result");
  }
  return rows[0].granted;
}
