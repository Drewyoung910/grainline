import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ReviewListingButtons } from "@/components/ReviewListingButtons";
import { DeleteListingButton } from "@/components/admin/DeleteListingButton";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Review Queue — Admin" };

export default async function AdminReviewPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { role: true },
  });
  if (!admin || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) redirect("/");

  const listings = await prisma.listing.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
    include: {
      seller: {
        select: {
          displayName: true,
          userId: true,
          _count: { select: { listings: true } },
        },
      },
      photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Review Queue</h1>
        <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${
          listings.length > 0 ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"
        }`}>
          {listings.length} pending
        </span>
      </div>

      {listings.length === 0 ? (
        <div className="border border-neutral-200 bg-white p-12 text-center">
          <p className="text-neutral-500">All clear — no listings pending review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {listings.map((listing) => {
            const isFirstListing = listing.seller._count.listings <= 1;
            const thumb = listing.photos[0]?.url;

            return (
              <div
                key={listing.id}
                className="border border-neutral-200 bg-white p-4 space-y-3"
              >
                <div className="flex gap-4">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt=""
                      className="h-20 w-20 object-cover border border-neutral-200 shrink-0"
                    />
                  ) : (
                    <div className="h-20 w-20 bg-neutral-100 border border-neutral-200 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <Link
                        href={`/listing/${listing.id}`}
                        target="_blank"
                        className="font-semibold hover:underline"
                      >
                        {listing.title}
                      </Link>
                      {isFirstListing && (
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full font-medium">
                          First listing
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-neutral-500 mt-0.5">
                      by {listing.seller.displayName} ·{" "}
                      ${(listing.priceCents / 100).toFixed(2)} ·{" "}
                      {new Date(listing.createdAt).toLocaleDateString("en-US")}
                    </div>
                    {listing.aiReviewFlags.length > 0 && (
                      <div className="mt-2">
                        <div className="text-xs font-medium text-amber-700 mb-1">AI flags:</div>
                        <ul className="space-y-0.5">
                          {listing.aiReviewFlags.map((flag, i) => (
                            <li key={i} className="text-xs text-amber-600">
                              • {flag}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {listing.aiReviewScore !== null && (
                      <div className="text-xs text-neutral-400 mt-1">
                        AI confidence: {Math.round((listing.aiReviewScore ?? 0) * 100)}%
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ReviewListingButtons listingId={listing.id} />
                  <DeleteListingButton listingId={listing.id} />
                  <Link
                    href={`/listing/${listing.id}`}
                    target="_blank"
                    className="text-sm text-neutral-500 underline hover:text-neutral-900"
                  >
                    Preview →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
