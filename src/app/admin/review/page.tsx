import { requireAdminPageAccess } from "@/lib/adminPageAccess";
import AdminPinGate from "@/components/AdminPinGate";
import { ReviewListingButtons } from "@/components/ReviewListingButtons";
import { DeleteListingButton } from "@/components/admin/DeleteListingButton";
import Link from "next/link";
import { publicListingPath } from "@/lib/publicPaths";
import { formatCurrencyCents } from "@/lib/money";
import type { Metadata } from "next";
import { getOrderStaffReadClient } from "@/lib/orderStaffReadDb";
import {
  sellerProfileStaffListingReviewQueue,
  sellerProfileStaffReportTargets,
} from "@/lib/sellerProfileStaffAccess";

export const metadata: Metadata = { title: "Review Queue — Admin" };

const REVIEW_QUEUE_LIMIT = 100;
const SELLER_TARGET_CHUNK_SIZE = 50;

export default async function AdminReviewPage() {
  const staff = await requireAdminPageAccess();
  if (!staff) return <AdminPinGate />;

  const staffClient = getOrderStaffReadClient();
  const reviewQueue = await sellerProfileStaffListingReviewQueue(staffClient, {
    actorId: staff.id,
    limit: REVIEW_QUEUE_LIMIT,
  });
  const { totalPending, listings } = reviewQueue;
  const sellerProfileIds = [...new Set(listings.map((listing) => listing.sellerId))];
  const sellerTargets = [];
  for (let start = 0; start < sellerProfileIds.length; start += SELLER_TARGET_CHUNK_SIZE) {
    sellerTargets.push(...await sellerProfileStaffReportTargets(staffClient, {
      actorId: staff.id,
      sellerProfileIds: sellerProfileIds.slice(start, start + SELLER_TARGET_CHUNK_SIZE),
    }));
  }
  const sellerTargetById = new Map(sellerTargets.map((seller) => [seller.id, seller]));
  if (sellerTargetById.size !== sellerProfileIds.length) {
    throw new Error("Admin listing review seller projection returned an incomplete result");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Review Queue</h1>
        <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${
          listings.length > 0 ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600"
        }`}>
          {totalPending} pending
        </span>
      </div>

      {totalPending > listings.length && (
        <p className="text-sm text-neutral-500">
          Showing the oldest {listings.length} listings pending review.
        </p>
      )}

      {listings.length === 0 ? (
        <div className="border border-neutral-200 bg-white p-12 text-center">
          <p className="text-neutral-500">All clear — no listings pending review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {listings.map((listing) => {
            const seller = sellerTargetById.get(listing.sellerId);
            if (!seller) {
              throw new Error("Admin listing review seller projection is missing a target");
            }
            const isFirstListing = listing.sellerListingCount <= 1;
            const thumb = listing.photoUrl;

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
                        href={publicListingPath(listing.id, listing.title)}
                        target="_blank"
                        rel="noopener noreferrer"
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
                      by {seller.displayName} ·{" "}
                      {formatCurrencyCents(listing.priceCents, listing.currency)} ·{" "}
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
                      <div className="text-xs text-neutral-500 mt-1">
                        AI confidence: {Math.round((listing.aiReviewScore ?? 0) * 100)}%
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ReviewListingButtons
                    listingId={listing.id}
                    reviewedAt={listing.updatedAt.toISOString()}
                  />
                  <DeleteListingButton
                    listingId={listing.id}
                    reviewedAt={listing.updatedAt.toISOString()}
                  />
                  <Link
                    href={`${publicListingPath(listing.id, listing.title)}?preview=admin`}
                    target="_blank"
                    rel="noopener noreferrer"
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
