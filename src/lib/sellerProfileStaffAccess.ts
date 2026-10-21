import type { Prisma } from "@prisma/client";

type SellerProfileStaffClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerProfileStaffReportTarget = Readonly<{
  id: string;
  displayName: string;
}>;

export type SellerProfileStaffBroadcastTarget = Readonly<{
  broadcastId: string;
  sellerProfileId: string;
  sellerUserId: string;
  sellerDisplayName: string;
}>;

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

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

export async function sellerProfileStaffBroadcastTargets(
  client: SellerProfileStaffClient,
  input: { actorId: string; broadcastIds: string[] },
) {
  if (input.broadcastIds.length === 0) return [];
  const broadcastIds = [...new Set(input.broadcastIds)];
  if (broadcastIds.length > 50 || broadcastIds.some((id) => !validId(id))) {
    throw new RangeError("Seller broadcast target input exceeds its bound");
  }
  const requested = new Set(broadcastIds);
  const returned = new Set<string>();
  const rows = await client.$queryRaw<SellerProfileStaffBroadcastTarget[]>`
    SELECT * FROM public.grainline_seller_staff_broadcast_targets(
      ${input.actorId}::text,
      ${broadcastIds}::text[]
    )
  `;
  if (rows.length > requested.size || rows.some((row) => {
    const valid = validId(row.broadcastId)
      && requested.has(row.broadcastId)
      && !returned.has(row.broadcastId)
      && validId(row.sellerProfileId)
      && validId(row.sellerUserId)
      && typeof row.sellerDisplayName === "string"
      && row.sellerDisplayName.length > 0
      && row.sellerDisplayName.length <= 100;
    returned.add(row.broadcastId);
    return !valid;
  })) {
    throw new Error("Seller broadcast target authority returned an invalid result");
  }
  return rows;
}
