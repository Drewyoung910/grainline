// src/components/ReviewsSection.tsx
import { prisma } from "@/lib/db";
import ReviewComposer from "@/components/ReviewComposer";
import { HelpfulButton, SellerReplyForm } from "@/components/ReviewItemClient";
import Link from "next/link";

function quarterRound(n: number) {
  return Math.min(5, Math.max(0, Math.round(n * 4) / 4));
}

function Stars({ value }: { value: number }) {
  const pct = (value / 5) * 100;
  return (
    <div className="relative leading-none" title={`${value.toFixed(1)} out of 5`}>
      <div className="text-neutral-300">★★★★★</div>
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <div className="text-amber-500">★★★★★</div>
      </div>
    </div>
  );
}

export default async function ReviewsSection({
  listingId,
  meId,
  sellerUserId,              // Clerk user id (validated again in API)
  initialSort = "top",
  edit = false,              // ?redit=1 toggles edit UI
}: {
  listingId: string;
  meId: string | null;
  sellerUserId: string | null;
  initialSort?: "top" | "new" | "rating" | "photos";
  edit?: boolean;
}) {
  const basePath = `/listing/${listingId}`;
  const sort = initialSort;

  // Aggregate
  const agg = await prisma.review.aggregate({
    where: { listingId },
    _avg: { ratingX2: true },
    _count: { _all: true },
  });
  const avg = agg._avg.ratingX2 ? agg._avg.ratingX2 / 2 : null;
  const avgQuarter = avg != null ? quarterRound(avg) : null;

  // Gating: has the viewer bought this listing? (for Helpful)
  let viewerBought = false;
  if (meId) {
    const has = await prisma.order.findFirst({
      where: { buyerId: meId, items: { some: { listingId } }, paidAt: { not: null } },
      select: { id: true },
    });
    viewerBought = !!has;
  }

  // Viewer's review (full)
  const mine = meId
    ? await prisma.review.findFirst({
        where: { listingId, reviewerId: meId },
        include: {
          reviewer: { select: { id: true, name: true, email: true, imageUrl: true } },
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
    where: { listingId },
    include: {
      reviewer: { select: { id: true, name: true, email: true, imageUrl: true } },
      photos: { orderBy: { sortOrder: "asc" } },
    },
  });
  const others = mine ? all.filter((r) => r.id !== mine.id) : all;

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
        <h2 className="text-lg font-semibold">Reviews</h2>
        {avgQuarter != null && (
          <div className="flex items-center gap-2 text-sm text-neutral-700">
            <Stars value={avgQuarter} />
            <span>{(Math.round((avg ?? 0) * 10) / 10).toFixed(1)}</span>
            <span className="text-neutral-400">({agg._count._all})</span>
          </div>
        )}
      </div>

      {/* My review block */}
      {mine ? (
        <div className="rounded-xl border bg-white p-4">
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
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {mine.reviewer.imageUrl ? (
                  <img src={mine.reviewer.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10px] font-medium text-neutral-700">
                    {(mine.reviewer.name || mine.reviewer.email || "U")
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase() ?? "")
                      .join("") || "U"}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <Stars value={mine.ratingX2 / 2} />
                  <span className="text-neutral-700">{(mine.ratingX2 / 2).toFixed(1)}</span>
                  {mine.verified && (
                    <span className="ml-2 rounded-full border px-2 py-0.5 text-[11px]">Verified purchase</span>
                  )}
                  <span className="ml-auto text-xs text-neutral-500">
                    {new Date(mine.createdAt).toLocaleDateString()}
                  </span>
                </div>
                {mine.comment && (
                  <p className="mt-2 text-sm whitespace-pre-wrap break-words">{mine.comment}</p>
                )}
                {mine.photos.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {mine.photos.map((p) => (
                      <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover border" />
                      </a>
                    ))}
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

      {/* Sort pills */}
      <div className="flex items-center gap-2 text-sm">
        {(["top", "new", "rating", "photos"] as const).map((k) => {
          const active = sort === k;
          return (
            <Link
              key={k}
              href={sortHref(k, edit)}
              className={`rounded-full border px-3 py-1 hover:bg-neutral-50 ${
                active ? "bg-neutral-900 text-white hover:bg-neutral-900" : ""
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
        <div className="rounded-xl border bg-white p-6 text-neutral-600">No reviews yet — be the first to share your experience.</div>
      ) : (
        <ul className="space-y-4">
          {sorted.map((r) => {
            const stars = r.ratingX2 / 2;
            const initials =
              (r.reviewer.name || r.reviewer.email || "U")
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((w) => w[0]?.toUpperCase() ?? "")
                .join("") || "U";

            return (
              <li key={r.id} className="rounded-xl border bg-white p-4">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 overflow-hidden flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.reviewer.imageUrl ? (
                      <img src={r.reviewer.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] font-medium text-neutral-700">{initials}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Stars value={stars} />
                      <span className="text-neutral-700">{stars.toFixed(1)}</span>
                      {r.verified && (
                        <span className="ml-2 rounded-full border px-2 py-0.5 text-[11px]">Verified purchase</span>
                      )}
                      <span className="ml-auto text-xs text-neutral-500">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    {r.comment && (
                      <p className="mt-2 text-sm whitespace-pre-wrap break-words">{r.comment}</p>
                    )}

                    {r.photos.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {r.photos.map((p) => (
                          <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt="" className="h-16 w-16 rounded-lg object-cover border" />
                          </a>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-3">
                      <HelpfulButton
                        reviewId={r.id}
                        initialCount={r.helpfulCount}
                        initiallyVoted={false}
                        canVote={!!meId && viewerBought}
                      />

                      {r.sellerReply ? (
                        <div className="ml-auto w-full">
                          <div className="mt-2 rounded-lg border bg-neutral-50 p-3 text-sm">
                            <div className="mb-1 text-xs text-neutral-500">Seller reply</div>
                            <div>{r.sellerReply}</div>
                            <div className="mt-1 text-[11px] text-neutral-500">
                              {r.sellerReplyAt ? new Date(r.sellerReplyAt).toLocaleString() : ""}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="ml-auto">
                          <SellerReplyForm reviewId={r.id} canReply={!!sellerUserId} />
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



