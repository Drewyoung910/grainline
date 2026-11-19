import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { withDbUserContext } from "@/lib/dbUserContext";

type ListingAnalyticsClient = Pick<PrismaClient | Prisma.TransactionClient, "$queryRaw">;
const LISTING_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;

async function increment(
  client: ListingAnalyticsClient,
  listingId: string,
  eventKind: "view" | "click",
) {
  const rows = await client.$queryRaw<Array<{ tracked: unknown }>>`
    SELECT public.grainline_listing_public_analytics_increment(
      ${listingId}::text,
      ${eventKind}::text
    ) AS tracked
  `;
  if (rows.length !== 1 || typeof rows[0]?.tracked !== "boolean") {
    throw new Error("Listing analytics authority returned an invalid result");
  }
  return rows[0].tracked;
}

export function incrementPublicListingAnalytics(input: {
  listingId: string;
  eventKind: "view" | "click";
  viewerUserId: string | null;
}) {
  if (!LISTING_ID_PATTERN.test(input.listingId)) {
    return Promise.resolve(false);
  }
  if (input.viewerUserId) {
    return withDbUserContext(input.viewerUserId, (tx) =>
      increment(tx, input.listingId, input.eventKind)
    );
  }
  return increment(prisma, input.listingId, input.eventKind);
}
