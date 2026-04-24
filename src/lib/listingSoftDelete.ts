import { prisma } from "@/lib/db";

export async function softDeleteListingWithCleanup(listingId: string) {
  await prisma.$transaction([
    prisma.favorite.deleteMany({ where: { listingId } }),
    prisma.stockNotification.deleteMany({ where: { listingId } }),
    prisma.cartItem.deleteMany({ where: { listingId } }),
    prisma.listing.update({
      where: { id: listingId },
      data: { status: "HIDDEN", isPrivate: true },
    }),
  ]);
}

