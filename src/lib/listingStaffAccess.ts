import type { Prisma } from "@prisma/client";

import { isTextWithinCodePointRange } from "@/lib/textLength";

type ListingStaffClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type ListingStaffReferenceRow = Readonly<{
  id: unknown;
  title: unknown;
}>;

type ListingStaffSellerCountRow = Readonly<{
  activePublicCount: unknown;
}>;

const ID = /^[A-Za-z0-9._:-]{1,191}$/u;

export async function listingStaffReferenceTargets(
  client: ListingStaffClient,
  input: Readonly<{ actorId: string; listingIds: ReadonlyArray<string> }>,
) {
  const listingIds = [...new Set(input.listingIds)];
  if (
    !ID.test(input.actorId)
    || listingIds.length < 1
    || listingIds.length > 50
    || listingIds.some((listingId) => !ID.test(listingId))
  ) {
    throw new RangeError("Listing staff-reference input is invalid");
  }
  const requestedIds = new Set(listingIds);
  const returnedIds = new Set<string>();
  const rows = await client.$queryRaw<ListingStaffReferenceRow[]>`
    SELECT * FROM public.grainline_listing_staff_reference_targets(
      ${input.actorId}::text,
      ${listingIds}::text[]
    )
  `;
  if (
    rows.length > listingIds.length
    || rows.some((row) => {
      const valid = typeof row.id === "string"
        && requestedIds.has(row.id)
        && !returnedIds.has(row.id)
        && isTextWithinCodePointRange(row.title, 1, 150);
      if (typeof row.id === "string") returnedIds.add(row.id);
      return !valid;
    })
  ) {
    throw new Error("Listing staff-reference authority returned an invalid result");
  }
  return rows as ReadonlyArray<Readonly<{ id: string; title: string }>>;
}

export async function listingStaffSellerActivePublicCount(
  client: ListingStaffClient,
  input: Readonly<{ actorId: string; sellerProfileId: string }>,
) {
  if (!ID.test(input.actorId) || !ID.test(input.sellerProfileId)) {
    throw new RangeError("Listing staff seller-count input is invalid");
  }
  const rows = await client.$queryRaw<ListingStaffSellerCountRow[]>`
    SELECT * FROM public.grainline_listing_staff_seller_active_public_count(
      ${input.actorId}::text,
      ${input.sellerProfileId}::text
    )
  `;
  const value = rows[0]?.activePublicCount;
  const count = typeof value === "bigint" ? Number(value) : Number.NaN;
  if (rows.length !== 1 || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Listing staff seller-count authority returned an invalid result");
  }
  return count;
}
