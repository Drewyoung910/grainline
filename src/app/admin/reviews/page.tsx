import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { DeleteReviewButton } from "@/components/admin/DeleteReviewButton";

export const metadata: Metadata = { title: "Reviews — Admin" };

export default async function AdminReviewsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!admin || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) redirect("/");

  const reviews = await prisma.review.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      reviewer: { select: { name: true, email: true } },
      listing: { select: { id: true, title: true } },
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-semibold font-display mb-6">All Reviews</h1>
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
                  <span className="text-xs text-neutral-400">on</span>
                  <Link href={`/listing/${r.listing.id}`} className="text-xs text-neutral-600 hover:underline">
                    {r.listing.title}
                  </Link>
                  <span className="text-xs text-neutral-400">
                    {new Date(r.createdAt).toLocaleDateString()}
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
    </main>
  );
}
