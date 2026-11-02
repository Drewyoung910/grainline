import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { userIdByClerkId } from "@/lib/userIdentityAccess";
import { extractRouteId, publicSellerPath, routeSegmentWithSlug } from "@/lib/publicPaths";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { sellerPublicCustomerPhotoHeader } from "@/lib/sellerProfilePublicAccess";
import { listingPublicCustomerPhotoPage } from "@/lib/listingReviewHistoryAccess";
import CustomerPhotosGallery from "@/components/CustomerPhotosGallery";

const PAGE_SIZE = 24;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
};

const getPublicCustomerPhotoHeader = cache((sellerId: string) =>
  sellerPublicCustomerPhotoHeader(null, sellerId));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const sellerId = extractRouteId(id);
  const seller = await getPublicCustomerPhotoHeader(sellerId);
  if (!seller) return {};
  const name = seller.displayName ?? "Maker";
  return {
    title: `Customer photos from ${name}`,
    description: `Real customer photos from buyers of ${name}'s handmade woodworking pieces.`,
    alternates: { canonical: `https://thegrainline.com${publicSellerPath(seller.id, name)}/customer-photos` },
  };
}

export default async function CustomerPhotosPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(sp.page, 1, 500);
  const sellerId = extractRouteId(id);

  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await userIdByClerkId(prisma, userId);
    meId = me?.id ?? null;
  }

  const seller = await sellerPublicCustomerPhotoHeader(meId, sellerId);
  if (!seller) return notFound();

  // Canonicalize URL slug
  if (id !== routeSegmentWithSlug(seller.id, seller.displayName, "maker")) {
    permanentRedirect(`/seller/${routeSegmentWithSlug(seller.id, seller.displayName, "maker")}/customer-photos${requestedPage > 1 ? `?page=${requestedPage}` : ""}`);
  }
  if (!seller.publicPhotosEligible) return notFound();

  const requestedPhotoPage = await listingPublicCustomerPhotoPage(
    meId,
    seller.id,
    (requestedPage - 1) * PAGE_SIZE,
    PAGE_SIZE,
  );
  const totalCount = requestedPhotoPage.total;

  // Empty state: redirect back to seller profile if no photos exist
  if (totalCount === 0) {
    return notFound();
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const photos = page === requestedPage
    ? requestedPhotoPage.photos
    : (await listingPublicCustomerPhotoPage(
        meId,
        seller.id,
        (page - 1) * PAGE_SIZE,
        PAGE_SIZE,
      )).photos;
  const currentSeller = await sellerPublicCustomerPhotoHeader(meId, sellerId);
  if (!currentSeller?.publicPhotosEligible) return notFound();

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
          listingId: p.listingId,
          listingTitle: p.listingTitle,
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
