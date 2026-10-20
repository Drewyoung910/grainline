import type { Prisma } from "@prisma/client";

type SellerProfileStaffClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerProfileStaffReportTarget = Readonly<{
  id: string;
  displayName: string;
}>;

export async function sellerProfileStaffReportTargets(
  client: SellerProfileStaffClient,
  input: { actorId: string; sellerProfileIds: string[] },
) {
  if (input.sellerProfileIds.length === 0) return [];
  const sellerProfileIds = [...new Set(input.sellerProfileIds)];
  if (sellerProfileIds.length > 50) {
    throw new Error("Seller report target input exceeds its bound");
  }
  const requested = new Set(sellerProfileIds);
  const returned = new Set<string>();
  const rows = await client.$queryRaw<SellerProfileStaffReportTarget[]>`
    SELECT * FROM public.grainline_seller_staff_report_targets(
      ${input.actorId}::text,
      ${sellerProfileIds}::text[]
    )
  `;
  if (rows.length > requested.size || rows.some((row) => {
    const valid = typeof row.id === "string"
      && typeof row.displayName === "string"
      && row.displayName.length > 0
      && row.displayName.length <= 100
      && requested.has(row.id)
      && !returned.has(row.id);
    returned.add(row.id);
    return !valid;
  })) {
    throw new Error("Seller report target authority returned an invalid result");
  }
  return rows;
}
