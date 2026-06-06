import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { DeleteReviewButton } from "@/components/admin/DeleteReviewButton";
import { publicListingPath } from "@/lib/publicPaths";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";

export const metadata: Metadata = { title: "Reviews — Admin" };

const PAGE_SIZE = 50;

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true, banned: true, deletedAt: true },
  });
  if (!admin || admin.banned || admin.deletedAt || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) redirect("/");

  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);
  const total = await prisma.review.count();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const reviews = await prisma.review.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    include: {
      reviewer: { select: { name: true, email: true } },
      listing: { select: { id: true, title: true } },
      photos: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
    },
  });

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-2xl font-semibold font-display">All Reviews</h1>
        <p className="text-sm text-neutral-500">
          {total} total{totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ""}
        </p>
      </div>
      <div className="space-y-3">
        {reviews.map((r) => (
          <div key={r.id} className="border border-neutral-200 rounded-lg p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-amber-500 text-sm">
                    {"★".repeat(Math.round(r.ratingX2 / 2))}{"☆".repeat(5 - Math.round(r.ratingX2 / 2))}
                  </span>
                  <span className="text-xs text-neutral-500">
                    by {r.reviewer.name ?? r.reviewer.email ?? "Unknown"}
                  </span>
                  <span className="text-xs text-neutral-500">on</span>
                  <Link href={publicListingPath(r.listing.id, r.listing.title)} className="text-xs text-neutral-600 hover:underline">
                    {r.listing.title}
                  </Link>
                  <span className="text-xs text-neutral-500">
                    {new Date(r.createdAt).toLocaleDateString("en-US")}
                  </span>
                </div>
                {r.comment && (
                  <p className="text-sm text-neutral-700 mt-1 line-clamp-3">{r.comment}</p>
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
              </div>
              <DeleteReviewButton reviewId={r.id} />
            </div>
          </div>
        ))}
        {reviews.length === 0 && (
          <p className="text-neutral-500 text-sm">No reviews yet.</p>
        )}
      </div>
      {totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={page === 2 ? "/admin/reviews" : `/admin/reviews?page=${page - 1}`}
              className="rounded-md border border-neutral-200 px-3 py-1.5 hover:bg-neutral-50"
            >
              ← Previous
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 px-3 py-1.5 text-neutral-500">← Previous</span>
          )}
          <span className="text-neutral-500">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link
              href={`/admin/reviews?page=${page + 1}`}
              className="rounded-md border border-neutral-200 px-3 py-1.5 hover:bg-neutral-50"
            >
              Next →
            </Link>
          ) : (
            <span className="rounded-md border border-neutral-200 px-3 py-1.5 text-neutral-500">Next →</span>
          )}
        </nav>
      )}
    </main>
  );
}
