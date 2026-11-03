// src/app/commission/page.tsx
import CommissionPostButton from "@/components/CommissionPostButton";
import { prisma } from "@/lib/db";
import { userClerkCommissionContext } from "@/lib/userIdentityAccess";
import Link from "next/link";
import SegmentedControl from "@/components/SegmentedControl";
import ScrollFadeRow from "@/components/ScrollFadeRow";
import { truncateTextWithEllipsis } from "@/lib/sanitize";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { Category } from "@prisma/client";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import CommissionInterestButton from "./CommissionInterestButton";
import { MapPin } from "@/components/icons";
import { safeJsonLd } from "@/lib/json-ld";
import { publicCommissionInterestCounts } from "@/lib/commissionInterestCount";
import {
  actorCommissionInterestRequestIds,
  publicCommissionRequestCount,
  publicCommissionRequestPage,
} from "@/lib/commissionRequestAccess";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { formatCommissionBudgetRange } from "@/lib/commissionBudget";
import { Suspense } from "react";
import { CommissionRoomSkeleton } from "@/components/RouteSkeletons";
import { commissionDistanceBucket } from "@/lib/locationPrivacy";

export const metadata: Metadata = {
  title: "Custom Woodworking Commissions — Find a Maker",
  description: "Post a custom woodworking commission request and get matched with skilled local and national makers. Describe your vision, set your budget, and let makers come to you.",
};

function timeAgo(dateStr: Date | string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type CommissionPageProps = {
  searchParams: Promise<{ page?: string; category?: string; tab?: string }>;
};

export default function CommissionPage(props: CommissionPageProps) {
  return (
    <Suspense fallback={<CommissionRoomSkeleton />}>
      <CommissionPageContent {...props} />
    </Suspense>
  );
}

async function CommissionPageContent({
  searchParams,
}: CommissionPageProps) {
  const sp = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(sp.page, 1, 1000);
  let page = requestedPage;
  const categoryFilter = sp.category ?? "";
  const categoryValid = categoryFilter && CATEGORY_VALUES.includes(categoryFilter);
  const tab = sp.tab === "near" ? "near" : "all";
  const pageSize = 20;

  // Get current user + location + seller profile
  const { userId } = await auth();
  let meId: string | null = null;
  let sellerProfileId: string | null = null;
  let viewerLat: number | null = null;
  let viewerLng: number | null = null;

  if (userId) {
    const me = await userClerkCommissionContext(prisma, userId);
    if (me) {
      meId = me.id;
      sellerProfileId = me.sellerProfile?.id ?? null;
      if (me.sellerProfile?.lat != null) viewerLat = Number(me.sellerProfile.lat);
      if (me.sellerProfile?.lng != null) viewerLng = Number(me.sellerProfile.lng);
    }
  }

  const hasLocation = viewerLat != null && viewerLng != null;
  // The bounded authority owns visibility, reciprocal blocks, expiry and the
  // privacy-safe distance calculation for both tabs.
  const publicFilter = {
    category: categoryValid ? categoryFilter as Category : null,
    near: tab === "near" && hasLocation
      ? { lat: viewerLat!, lng: viewerLng!, radiusMeters: 80000 }
      : null,
  };
  const total = await publicCommissionRequestCount(meId, publicFilter);
  page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  const { rows: found } = await publicCommissionRequestPage(meId, {
    ...publicFilter,
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  const interestCounts = found.length > 0
    ? await publicCommissionInterestCounts(found.map(({ id }) => id), meId)
    : new Map<string, number>();
  const requests = found.map((request) => ({
    id: request.id,
    title: request.title,
    description: request.description,
    category: request.category,
    budgetMinCents: request.budgetMinCents,
    budgetMaxCents: request.budgetMaxCents,
    timeline: request.timeline,
    referenceImageUrls: request.referenceImageUrls,
    interestedCount: interestCounts.get(request.id) ?? 0,
    createdAt: request.createdAt,
    isNational: request.isNational,
    buyer: { name: request.buyerName, imageUrl: request.buyerImageUrl },
    distanceMeters: request.distanceMeters ?? undefined,
  }));

  const totalPages = Math.ceil(total / pageSize);

  // Load interest set for this seller
  let interestedSet = new Set<string>();
  if (sellerProfileId && requests.length > 0) {
    interestedSet = await actorCommissionInterestRequestIds(
      meId!,
      requests.map((request) => request.id),
    );
  }

  function buildHref(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (categoryFilter) p.set("category", categoryFilter);
    if (tab === "near") p.set("tab", "near");
    if (page > 1) p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    const qs = p.toString();
    return `/commission${qs ? `?${qs}` : ""}`;
  }

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "How do custom woodworking commissions work on Grainline?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Post a request describing the custom piece you want, including details like dimensions, wood type, and budget. Skilled makers browse requests and express interest. You review their profiles, past work, and ratings, then connect directly via messages to discuss your project and finalize details.",
        },
      },
      {
        "@type": "Question",
        name: "How much does a custom woodworking commission cost?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Pricing varies based on the complexity, size, wood species, and maker experience. You set your own budget range when posting a request, and makers who can work within that range will express interest. Most custom pieces range from $100 for small items to several thousand dollars for large furniture.",
        },
      },
      {
        "@type": "Question",
        name: "How long does a custom commission take?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Timelines depend on the maker's schedule and the complexity of your piece. Simple items may take 1-2 weeks, while complex furniture can take 2-3 months. You can specify your preferred timeline when posting a request, and makers will let you know if they can meet it.",
        },
      },
    ],
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      {/* FAQ JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqLd) }}
      />

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold font-display text-neutral-900">Commission Room</h1>
          <p className="text-neutral-500 mt-1 text-sm">
            Buyers post custom piece requests. Makers express interest to connect.
          </p>
        </div>
        <CommissionPostButton className="btn btn-sm btn-primary shrink-0 whitespace-nowrap px-3 sm:px-5">
          <span className="sm:hidden">Post request</span>
          <span className="hidden sm:inline">Post a Request</span>
        </CommissionPostButton>
      </div>

      {/* Tab strip — only when there is a second tab ("Near Me" needs a
          seller location); a lone "All Requests" tab looks broken. */}
      {hasLocation && (
        <div className="mb-6">
          <SegmentedControl
            label="Requests"
            value={tab === "near" ? "near" : "all"}
            options={[
              { value: "all", label: "All requests", href: buildHref({ tab: "", page: "" }) },
              {
                value: "near",
                href: buildHref({ tab: "near", page: "" }),
                label: <span className="flex items-center gap-1"><MapPin size={13} /> Near me</span>,
              },
            ]}
          />
        </div>
      )}

      {/* How it works explainer */}
      <div className="bg-amber-50 border border-amber-200/60 rounded-lg p-4 mb-6">
        <h2 className="font-medium text-amber-900 mb-1">How the Commission Room works</h2>
        <p className="text-sm text-amber-800">
          Post a custom piece request describing what you need. Makers browse requests and express interest.
          You review interested makers and connect directly via messages to discuss your project.
        </p>
      </div>

      {/* Category filter */}
      <ScrollFadeRow className="mb-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex min-w-max gap-2 pr-1">
          <Link
            href={buildHref({ category: "", page: "" })}
            className={`inline-flex h-9 items-center rounded-full px-3.5 text-sm whitespace-nowrap transition-colors ${
              !categoryFilter ? "bg-[#2C1F1A] text-white" : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
            }`}
          >
            All
          </Link>
          {CATEGORY_VALUES.map((cat) => (
            <Link
              key={cat}
              href={buildHref({ category: cat, page: "" })}
              className={`inline-flex h-9 items-center rounded-full px-3.5 text-sm whitespace-nowrap transition-colors ${
                categoryFilter === cat ? "bg-[#2C1F1A] text-white" : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </Link>
          ))}
        </div>
      </ScrollFadeRow>

      {requests.length === 0 ? (
        <div className="card-section p-12 text-center">
          <p className="text-lg font-medium text-neutral-700 mb-2">No commission requests yet</p>
          <p className="text-sm text-neutral-500 mb-6">
            Be the first to post a custom piece request. Describe what you&apos;re looking for
            and makers will reach out directly.
          </p>
          <CommissionPostButton className="btn btn-primary">
            Post a Request →
          </CommissionPostButton>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => {
            const buyerName = r.buyer.name?.split(" ")[0] ?? "Buyer";
            return (
              <div key={r.id} className="card-listing p-5">
                <div className="flex items-start gap-4">
                  {/* Thumbnail */}
                  {r.referenceImageUrls[0] && (
                    <Link href={`/commission/${r.id}`} className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.referenceImageUrls[0]}
                        alt="Reference"
                        loading="lazy"
                        className="w-24 h-24 object-cover rounded-lg border border-stone-200"
                      />
                    </Link>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <Link href={`/commission/${r.id}`} className="font-medium text-neutral-900 hover:underline">
                        {r.title}
                      </Link>
                      {r.category && (
                        <span className="text-xs text-stone-500 border border-stone-200 rounded-full px-2 py-0.5 shrink-0">
                          {CATEGORY_LABELS[r.category]}
                        </span>
                      )}
                    </div>

                    {/* Budget — most prominent element */}
                    {formatCommissionBudgetRange(r.budgetMinCents, r.budgetMaxCents) && (
                      <div className="font-semibold text-lg text-amber-700 mb-1">
                        {formatCommissionBudgetRange(r.budgetMinCents, r.budgetMaxCents)}
                      </div>
                    )}

                    <p className="text-sm text-stone-500 line-clamp-2 mb-2">
                      {truncateTextWithEllipsis(r.description, 200)}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                      {/* Timeline */}
                      {r.timeline && <span className="text-stone-500">{r.timeline}</span>}
                      {/* Buyer */}
                      <span className="flex items-center gap-1">
                        {r.buyer.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.buyer.imageUrl} alt={buyerName} className="w-4 h-4 rounded-full object-cover" />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-neutral-200" />
                        )}
                        {buyerName}
                      </span>
                      {/* Time */}
                      <span>{timeAgo(r.createdAt)}</span>
                      {/* Interest count */}
                      <span>{r.interestedCount} maker{r.interestedCount !== 1 ? "s" : ""} interested</span>
                      {/* Local distance badge */}
                      {!r.isNational && commissionDistanceBucket(r.distanceMeters) && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5">
                          <MapPin size={11} /> {commissionDistanceBucket(r.distanceMeters)}
                        </span>
                      )}
                      {!r.isNational && r.distanceMeters == null && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5">
                          <MapPin size={11} /> Local request
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Interest button — only for sellers, not buyer */}
                  {sellerProfileId && (
                    <CommissionInterestButton
                      requestId={r.id}
                      sellerProfileId={sellerProfileId}
                      initialInterested={interestedSet.has(r.id)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          {page > 1 && (
            <Link href={buildHref({ page: String(page - 1) })} className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50">
              ← Previous
            </Link>
          )}
          <span className="border border-neutral-200 px-4 py-2 text-sm bg-neutral-50 text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={buildHref({ page: String(page + 1) })} className="border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50">
              Next →
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
