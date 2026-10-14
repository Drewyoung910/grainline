import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerProfileViewClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function recordSellerProfileView(
  sellerProfileId: string,
  viewedOn: Date,
  client: SellerProfileViewClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ recorded: boolean }>>`
    SELECT public.grainline_seller_profile_view_record(
      ${sellerProfileId}::text,
      ${viewedOn}::date
    ) AS recorded
  `;
  if (rows.length !== 1 || typeof rows[0]?.recorded !== "boolean") {
    throw new Error("Seller profile-view authority returned an invalid result");
  }
  return rows[0].recorded;
}
