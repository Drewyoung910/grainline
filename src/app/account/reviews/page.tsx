import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { ensureUserForPage } from "@/lib/pageAuth";
import { DeleteOwnReviewButton } from "@/components/DeleteOwnReviewButton";
import { publicListingPath } from "@/lib/publicPaths";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";

export const metadata: Metadata = { title: "My Reviews", robots: { index: false, follow: false } };

const PAGE_SIZE = 20;

export default async function MyReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const me = await ensureUserForPage("/account/reviews");

  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);
  const totalReviews = await prisma.review.count({ where: { reviewerId: me.id } });
  const totalPages = Math.max(1, Math.ceil(totalReviews / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const reviews = await prisma.review.findMany({
    where: { reviewerId: me.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      listing: {
        select: {
          id: true,
          title: true,
          photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        },
      },
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
      <div className="mb-6">
        <Link href="/account" className="text-sm text-neutral-500 hover:underline">← My Account</Link>
        <h1 className="text-2xl font-display font-semibold text-neutral-900 mt-2">My Reviews</h1>
        <p className="text-sm text-neutral-500 mt-1">{totalReviews} review{totalReviews !== 1 ? "s" : ""}</p>
      </div>

      {reviews.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-neutral-500 text-sm">You haven&apos;t written any reviews yet.</p>
          <Link href="/browse" className="mt-4 inline-block text-sm text-neutral-700 hover:underline">
            Browse listings →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-lg border border-stone-200/60 bg-[#EFEAE0] p-4 flex gap-4">
              {r.listing.photos[0]?.url && (
                <Link href={publicListingPath(r.listing.id, r.listing.title)} className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.listing.photos[0].url}
                    alt={r.listing.title}
                    className="h-16 w-16 rounded-lg object-cover"
                  />
                </Link>
              )}
              <div className="flex-1 min-w-0">
                <Link href={publicListingPath(r.listing.id, r.listing.title)} className="font-medium text-sm text-neutral-900 hover:underline line-clamp-1">
                  {r.listing.title}
                </Link>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-amber-500 text-sm">
                    {"★".repeat(Math.round(r.ratingX2 / 2))}{"☆".repeat(5 - Math.round(r.ratingX2 / 2))}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {new Date(r.createdAt).toLocaleDateString("en-US")}
                  </span>
                  <span className="text-xs text-neutral-300">·</span>
                  <DeleteOwnReviewButton reviewId={r.id} />
                </div>
                {r.comment && (
                  <p className="text-sm text-neutral-600 mt-1 line-clamp-3">{r.comment}</p>
                )}
                {r.photos.length > 0 && (
                  <div className="flex gap-1.5 mt-2">
                    {r.photos.map((photo) => (
                      <a key={photo.id} href={photo.url} target="_blank" rel="noopener noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo.url}
                          alt=""
                          className="h-12 w-12 rounded border object-cover hover:opacity-80 transition-opacity"
                        />
                      </a>
                    ))}
                  </div>
                )}
                {r.sellerReply && (
                  <div className="mt-2 pl-3 border-l-2 border-amber-200">
                    <p className="text-xs text-neutral-500 font-medium">Seller replied:</p>
                    <p className="text-xs text-neutral-600 mt-0.5 line-clamp-2">{r.sellerReply}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          {page > 1 && (
            <Link
              href={`/account/reviews?page=${page - 1}`}
              className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
            >
              ← Previous
            </Link>
          )}
          <span className="text-sm text-neutral-600">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/account/reviews?page=${page + 1}`}
              className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
            >
              Next →
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
