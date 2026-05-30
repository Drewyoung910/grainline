import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getBlockedUserIdsFor } from "@/lib/blocks";
import { publicListingDetailWhere } from "@/lib/listingVisibility";
import { visibleSellerProfileWhere } from "@/lib/sellerVisibility";
import { extractRouteId, publicSellerPath, routeSegmentWithSlug } from "@/lib/publicPaths";
import CustomerPhotosGallery from "@/components/CustomerPhotosGallery";

const PAGE_SIZE = 24;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const sellerId = extractRouteId(id);
  const seller = await prisma.sellerProfile.findFirst({
    where: visibleSellerProfileWhere({ id: sellerId }),
    select: { displayName: true },
  });
  if (!seller) return {};
  const name = seller.displayName ?? "Maker";
  return {
    title: `Customer photos from ${name} | Grainline`,
    description: `Real customer photos from buyers of ${name}'s handmade woodworking pieces.`,
    alternates: { canonical: `https://thegrainline.com/seller/${sellerId}/customer-photos` },
  };
}

export default async function CustomerPhotosPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const sellerId = extractRouteId(id);

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      displayName: true,
      user: { select: { id: true, banned: true, deletedAt: true, clerkId: true } },
    },
  });
  if (!seller) return notFound();
  if (seller.user?.banned || seller.user?.deletedAt) return notFound();

  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meId = me?.id ?? null;
  }
  const isOwner = !!userId && seller.user?.clerkId === userId;
  if (!isOwner) {
    const isVisibleSeller = await prisma.sellerProfile.count({
      where: visibleSellerProfileWhere({ id: seller.id }),
    });
    if (!isVisibleSeller) return notFound();
  }

  const blockedUserIds = await getBlockedUserIdsFor(meId);
  if (seller.user?.id && blockedUserIds.has(seller.user.id)) {
    return notFound();
  }

  // Canonicalize URL slug
  if (id !== routeSegmentWithSlug(seller.id, seller.displayName, "maker")) {
    permanentRedirect(`/seller/${routeSegmentWithSlug(seller.id, seller.displayName, "maker")}/customer-photos${page > 1 ? `?page=${page}` : ""}`);
  }

  const blockedReviewerFilter = blockedUserIds.size > 0
    ? { reviewerId: { notIn: [...blockedUserIds] } }
    : {};
  const photoWhere = {
    review: {
      ...blockedReviewerFilter,
      reviewer: { banned: false, deletedAt: null },
      listing: publicListingDetailWhere({ sellerId: seller.id }),
    },
  };

  const [photos, totalCount] = await Promise.all([
    prisma.reviewPhoto.findMany({
      where: photoWhere,
      orderBy: { review: { createdAt: "desc" } },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        url: true,
        altText: true,
        review: { select: { listingId: true, listing: { select: { title: true } } } },
      },
    }),
    prisma.reviewPhoto.count({ where: photoWhere }),
  ]);

  // Empty state: redirect back to seller profile if no photos exist
  if (totalCount === 0) {
    return notFound();
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <div className="mb-8">
        <Link
          href={publicSellerPath(seller.id, seller.displayName)}
          className="text-sm text-amber-700 hover:underline inline-flex items-center gap-1"
        >
          ← Back to {seller.displayName}
        </Link>
        <h1 className="font-display text-3xl sm:text-4xl font-bold mt-3">Customer photos</h1>
        <p className="text-neutral-600 mt-1">
          {totalCount.toLocaleString("en-US")} {totalCount === 1 ? "photo" : "photos"} from buyers of{" "}
          {seller.displayName}&apos;s pieces.
        </p>
      </div>

      <CustomerPhotosGallery
        photos={photos.map((p) => ({
          id: p.id,
          url: p.url,
          altText: p.altText,
          listingId: p.review.listingId,
          listingTitle: p.review.listing?.title ?? null,
        }))}
      />

      {totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-4 text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={page === 2 ? `/seller/${id}/customer-photos` : `/seller/${id}/customer-photos?page=${page - 1}`}
              className="rounded-md border border-neutral-300 px-4 py-2 hover:bg-neutral-50"
            >
              ← Previous
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 px-4 py-2 text-neutral-500 cursor-not-allowed">← Previous</span>
          )}
          <span className="text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={`/seller/${id}/customer-photos?page=${page + 1}`}
              className="rounded-md border border-neutral-300 px-4 py-2 hover:bg-neutral-50"
            >
              Next →
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 px-4 py-2 text-neutral-500 cursor-not-allowed">Next →</span>
          )}
        </nav>
      )}
    </main>
  );
}
