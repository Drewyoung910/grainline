// src/components/ReviewsSection.tsx
import { prisma } from "@/lib/db";
import ReviewComposer from "@/components/ReviewComposer";
import { HelpfulButton, SellerReplyForm } from "@/components/ReviewItemClient";
import Link from "next/link";
import { ImageLightbox } from "@/components/ImageLightbox";
import BlockReportButton from "@/components/BlockReportButton";
import { publicListingPath } from "@/lib/publicPaths";
import { avatarInitials } from "@/lib/avatarInitials";

function quarterRound(n: number) {
  return Math.min(5, Math.max(0, Math.round(n * 4) / 4));
}

function Stars({ value }: { value: number }) {
  const pct = (value / 5) * 100;
  return (
    <div
      className="relative leading-none"
      title={`${value.toFixed(1)} out of 5`}
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      <div className="text-neutral-300" aria-hidden="true">★★★★★</div>
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <div className="text-amber-500" aria-hidden="true">★★★★★</div>
      </div>
    </div>
  );
}

type ReviewAuthorDisplay = {
  name: string | null;
  email: string | null;
  imageUrl: string | null;
  banned?: boolean | null;
  deletedAt?: Date | null;
};

function reviewerUnavailable(reviewer: ReviewAuthorDisplay) {
  return Boolean(reviewer.deletedAt || reviewer.banned);
}

function reviewerName(reviewer: ReviewAuthorDisplay) {
  if (reviewerUnavailable(reviewer)) return "Former buyer";
  return reviewer.name ?? reviewer.email?.split("@")[0] ?? "Buyer";
}

function reviewerInitials(reviewer: ReviewAuthorDisplay) {
  if (reviewerUnavailable(reviewer)) return "FB";
  return avatarInitials(reviewerName(reviewer), "B");
}

export default async function ReviewsSection({
  listingId,
  listingTitle,
  meId,
  sellerUserId,              // Clerk user id (validated again in API)
  initialSort = "top",
  edit = false,              // ?redit=1 toggles edit UI
  blockedUserIds,
}: {
  listingId: string;
  listingTitle?: string | null;
  meId: string | null;
  sellerUserId: string | null;
  initialSort?: "top" | "new" | "rating" | "photos";
  edit?: boolean;
  blockedUserIds?: string[];
}) {
  // Use the slug-canonical path so click navigation doesn't get
  // permanentRedirected (which strips query params + drops the sort).
  const basePath = publicListingPath(listingId, listingTitle ?? null);
  const sort = initialSort;

  // Aggregate
  const agg = await prisma.review.aggregate({
    where: { listingId },
    _avg: { ratingX2: true },
    _count: { _all: true },
  });
  const avg = agg._avg.ratingX2 ? agg._avg.ratingX2 / 2 : null;
  const avgQuarter = avg != null ? quarterRound(avg) : null;

  // Is the viewer the seller of this listing? (sellers can't mark their
  // own listing's reviews helpful — would let them boost their best ones.)
  let viewerIsSeller = false;
  if (meId) {
    const listingRow = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { seller: { select: { userId: true } } },
    });
    viewerIsSeller = listingRow?.seller.userId === meId;
  }

  // Viewer's review (full)
  const mine = meId
    ? await prisma.review.findFirst({
      where: { listingId, reviewerId: meId },
      include: {
          reviewer: { select: { id: true, name: true, email: true, imageUrl: true, banned: true, deletedAt: true } },
          photos: { orderBy: { sortOrder: "asc" } },
        },
      })
    : null;

  // Can viewer create a review? (90d window + verified purchase)
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  let canCreate = false;
  if (meId && !mine) {
    const paidOrder = await prisma.orderItem.findFirst({
      where: { listingId, order: { buyerId: meId, paidAt: { not: null, gte: since90 } } },
      select: { id: true },
    });
    canCreate = !!paidOrder;
  }

  // All reviews (others)
  const all = await prisma.review.findMany({
    where: { listingId, ...(blockedUserIds && blockedUserIds.length > 0 ? { reviewerId: { notIn: blockedUserIds } } : {}) },
    include: {
      reviewer: { select: { id: true, name: true, email: true, imageUrl: true, banned: true, deletedAt: true } },
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });
  const others = mine ? all.filter((r) => r.id !== mine.id) : all;

  // Look up which of these reviews the current viewer has already marked
  // helpful, so the like button can render in its correct initial state
  // instead of always reading as "not voted yet".
  let votedReviewIds = new Set<string>();
  if (meId && others.length > 0) {
    const votes = await prisma.reviewVote.findMany({
      where: { userId: meId, reviewId: { in: others.map((r) => r.id) } },
      select: { reviewId: true },
    });
    votedReviewIds = new Set(votes.map((v) => v.reviewId));
  }

  // Fetch the seller profile once so the reply card can show the seller's
  // display name + avatar (much clearer than a generic "Seller reply" label).
  const sellerProfile = sellerUserId
    ? await prisma.sellerProfile.findFirst({
        where: { user: { clerkId: sellerUserId } },
        select: { id: true, displayName: true, avatarImageUrl: true, user: { select: { imageUrl: true } } },
      })
    : null;
  const sellerName = sellerProfile?.displayName ?? "Maker";
  const sellerAvatarUrl = sellerProfile?.avatarImageUrl ?? sellerProfile?.user?.imageUrl ?? null;

  const sorted = others.slice().sort((a, b) => {
    switch (sort) {
      case "new":
        return +new Date(b.createdAt) - +new Date(a.createdAt);
      case "rating":
        return b.ratingX2 - a.ratingX2 || +new Date(b.createdAt) - +new Date(a.createdAt);
      case "photos":
        return b.photos.length - a.photos.length || +new Date(b.createdAt) - +new Date(a.createdAt);
      default:
        return b.helpfulCount - a.helpfulCount || +new Date(b.createdAt) - +new Date(a.createdAt);
    }
  });

  // Link builders (always target listing path + #reviews)
  const sortHref = (k: "top" | "new" | "rating" | "photos", keepEdit = false) =>
    `${basePath}?rsort=${k}${keepEdit && edit ? `&redit=1` : ""}#reviews`;

  const editOnHref = `${basePath}?rsort=${sort}&redit=1#reviews`;
  const editOffHref = `${basePath}?rsort=${sort}#reviews`;

  // Compute edit lock (same rule as API: seller reply or >90d)
  const locked =
    !!mine?.sellerReply ||
    (mine ? Date.now() - new Date(mine.createdAt).getTime() > 90 * 24 * 60 * 60 * 1000 : false);

  return (
    <section id="reviews" className="space-y-4 mt-8 scroll-mt-20">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold font-display">Reviews</h2>
        {avgQuarter != null && (
          <div className="flex items-center gap-2 text-sm text-neutral-700">
            <Stars value={avgQuarter} />
            <span>{(Math.round((avg ?? 0) * 10) / 10).toFixed(1)}</span>
            <span className="text-neutral-500">({agg._count._all})</span>
          </div>
        )}
      </div>

      {/* My review block */}
      {mine ? (
        <div className="card-section px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-medium">My review</div>
            {edit ? (
              <Link href={editOffHref} className="text-sm underline" scroll={false}>
                Cancel
              </Link>
            ) : locked ? (
              <span className="text-xs rounded-full border px-2 py-0.5 text-neutral-500">Locked</span>
            ) : (
              <Link href={editOnHref} className="text-sm underline" scroll={false}>
                Edit
              </Link>
            )}
          </div>

          {edit && !locked ? (
            <ReviewComposer
              listingId={listingId}
              canReview={true}
              hasReview={true}
              isEditing
              existing={{
                id: mine.id,
                ratingX2: mine.ratingX2,
                comment: mine.comment ?? "",
                photos: mine.photos.map((p) => ({ id: p.id, url: p.url })),
                locked,
              }}
            />
          ) : (
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 overflow-hidden flex items-center justify-center">
                {!reviewerUnavailable(mine.reviewer) && mine.reviewer.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mine.reviewer.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] font-medium text-neutral-700">
                    {reviewerInitials(mine.reviewer)}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <Stars value={mine.ratingX2 / 2} />
                  <span className="text-neutral-700">{(mine.ratingX2 / 2).toFixed(1)}</span>
                  {mine.verified && (
                    <span className="whitespace-nowrap rounded-full bg-[#EFEAE0] px-3 py-1 text-[11px] font-medium text-neutral-700">
                      Verified purchase
                    </span>
                  )}
                  <span className="ml-auto text-xs text-neutral-500">
                    {new Date(mine.createdAt).toLocaleDateString("en-US")}
                  </span>
                </div>
                {mine.comment && (
                  <p className="mt-2 text-sm whitespace-pre-wrap break-words">{mine.comment}</p>
                )}
                {mine.photos.length > 0 && (
                  <div className="mt-2">
                    <ImageLightbox images={mine.photos.map((p) => p.url)} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        // No review yet → show composer if eligible
        <ReviewComposer listingId={listingId} canReview={canCreate} hasReview={false} />
      )}

      {/* Sort pills — flex-wrap allows wrapping on narrow viewports without
          stretching individual pills to two lines. whitespace-nowrap keeps
          each label on one line so all pills are the same height. */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["top", "new", "rating", "photos"] as const).map((k) => {
          const active = sort === k;
          return (
            <Link
              key={k}
              href={sortHref(k, edit)}
              className={`whitespace-nowrap rounded-full px-3 py-1 font-medium transition-colors ${
                active
                  ? "bg-neutral-900 text-white hover:bg-neutral-700"
                  : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
              }`}
              scroll={false}
            >
              {k === "top"
                ? "Top"
                : k === "new"
                ? "Newest"
                : k === "rating"
                ? "Highest rated"
                : "With photos"}
            </Link>
          );
        })}
      </div>

      {/* Others */}
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-stone-200/60 shadow-sm bg-[#EFEAE0] px-4 py-3 text-neutral-600">No reviews yet — be the first to share your experience.</div>
      ) : (
        <ul className="space-y-4">
          {sorted.map((r) => {
            const stars = r.ratingX2 / 2;
            const displayName = reviewerName(r.reviewer);
            const initials = reviewerInitials(r.reviewer);

            return (
              <li key={r.id} className="card-section px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 overflow-hidden flex items-center justify-center">
                    {!reviewerUnavailable(r.reviewer) && r.reviewer.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.reviewer.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] font-medium text-neutral-700">{initials}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                      <span className="font-medium text-neutral-800 truncate max-w-[140px]">{displayName}</span>
                      <Stars value={stars} />
                      <span className="text-neutral-700">{stars.toFixed(1)}</span>
                      {r.verified && (
                        <span className="whitespace-nowrap rounded-full bg-[#EFEAE0] px-3 py-1 text-[11px] font-medium text-neutral-700">
                          Verified purchase
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1">
                        <span className="text-xs text-neutral-500">
                          {new Date(r.createdAt).toLocaleDateString("en-US")}
                        </span>
                        {meId && meId !== r.reviewer.id && !reviewerUnavailable(r.reviewer) && (
                          <BlockReportButton
                            targetUserId={r.reviewer.id}
                            targetName={displayName}
                            targetType="REVIEW"
                            targetId={r.id}
                          />
                        )}
                      </span>
                    </div>

                    {r.comment && (
                      <p className="mt-2 text-sm whitespace-pre-wrap break-words">{r.comment}</p>
                    )}

                    {r.photos.length > 0 && (
                      <div className="mt-2">
                        <ImageLightbox images={r.photos.map((p) => p.url)} />
                      </div>
                    )}

                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-3">
                        <HelpfulButton
                          reviewId={r.id}
                          initialCount={r.helpfulCount}
                          initiallyVoted={votedReviewIds.has(r.id)}
                          canVote={!!meId && !viewerIsSeller && meId !== r.reviewer.id}
                          signedIn={!!meId}
                        />
                        {!r.sellerReply && sellerUserId && (
                          <div className="ml-auto">
                            <SellerReplyForm reviewId={r.id} canReply={!!sellerUserId} />
                          </div>
                        )}
                      </div>

                      {r.sellerReply && (
                        <div className="rounded-lg bg-[#EFEAE0] p-3 text-sm">
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="h-6 w-6 rounded-full bg-white overflow-hidden ring-1 ring-stone-200 shrink-0">
                              {sellerAvatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={sellerAvatarUrl} alt="" className="h-full w-full object-cover" />
                              ) : null}
                            </div>
                            <span className="font-semibold text-xs text-neutral-900">{sellerName}</span>
                            <span className="text-[11px] text-neutral-500">replied</span>
                            {r.sellerReplyAt && (
                              <span className="ml-auto text-[11px] text-neutral-500">
                                {new Date(r.sellerReplyAt).toLocaleDateString("en-US")}
                              </span>
                            )}
                          </div>
                          <p className="text-neutral-800 whitespace-pre-wrap break-words">{r.sellerReply}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
