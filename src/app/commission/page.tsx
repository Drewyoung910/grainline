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
import { getBlockedUserIdsFor } from "@/lib/blocks";
import { MapPin } from "@/components/icons";
import { openCommissionWhere } from "@/lib/commissionExpiry";
import { publicCommissionInterestCounts } from "@/lib/commissionInterestCount";
import { firstSearchParams, parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { formatCommissionBudgetRange } from "@/lib/commissionBudget";
import { Suspense } from "react";
import { CommissionRoomSkeleton } from "@/components/RouteSkeletons";
import { commissionDistanceBucket } from "@/lib/locationPrivacy";

export const metadata: Metadata = {
  title: "Custom Woodworking Commissions — Find a Maker",
  description: "Post a custom woodworking commission request and get matched with skilled local and national makers. Describe your vision, set your budget, and let makers come to you.",
  alternates: { canonical: "https://thegrainline.com/commission" },
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
  const sp = firstSearchParams(await searchParams);
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
  const blockedUserIds = await getBlockedUserIdsFor(meId);

  // Build where clause
  const where = openCommissionWhere({
    ...(categoryValid ? { category: categoryFilter as Category } : {}),
    ...(blockedUserIds.size > 0 ? { buyerId: { notIn: [...blockedUserIds] } } : {}),
  });

  // For Near Me tab: filter by distance using raw SQL
  let requests: Array<{
    id: string;
    title: string;
    description: string;
    category: Category | null;
    budgetMinCents: number | null;
    budgetMaxCents: number | null;
    timeline: string | null;
    referenceImageUrls: string[];
    interestedCount: number;
    createdAt: Date;
    isNational: boolean;
    buyer: { name: string | null; imageUrl: string | null };
    distanceMeters?: number;
  }>;
  let total: number;

  if (tab === "near" && hasLocation) {
    // Near Me: show local requests first, then national ones, filtered by 80km
    const radius = 80000; // 80km

    // SECURITY: $queryRawUnsafe is used here because Prisma's $queryRaw
    // tagged template cannot handle conditional SQL fragments. All user
    // input (categoryFilter) is passed as bound positional parameters ($9/$5),
    // never interpolated into the SQL string. categoryFilter is also
    // validated against CATEGORY_VALUES allowlist before reaching this code.
    const categoryConditionSelect = categoryValid ? `AND cr.category::text = $9` : "";
    const categoryConditionCount = categoryValid ? `AND cr.category::text = $5` : "";

    const countSql = `
      SELECT COUNT(*) FROM "CommissionRequest" cr
      WHERE cr.status = 'OPEN'
        AND (cr."expiresAt" IS NULL OR cr."expiresAt" > NOW())
        AND cr."buyerAccountActive" = true
        AND NOT (cr."buyerId" = ANY($4::text[]))
        ${categoryConditionCount}
        AND (
          cr."isNational" = true
          OR (cr.lat BETWEEN -90 AND 90 AND cr.lng BETWEEN -180 AND 180 AND
              6371000 * acos(
                LEAST(1.0, GREATEST(-1.0,
                  cos(radians($1)) * cos(radians(LEAST(89.975, GREATEST(-89.975, (floor(cr.lat::float8 * 20.0) + 0.5) / 20.0)))) *
                  cos(radians(LEAST(179.975, GREATEST(-179.975, (floor(cr.lng::float8 * 20.0) + 0.5) / 20.0))) - radians($2)) +
                  sin(radians($1)) * sin(radians(LEAST(89.975, GREATEST(-89.975, (floor(cr.lat::float8 * 20.0) + 0.5) / 20.0))))
                ))
              ) <= $3
          )
        )`;

    const countArgs: unknown[] = [viewerLat, viewerLng, radius, [...blockedUserIds]];
    if (categoryValid) countArgs.push(categoryFilter);
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(countSql, ...countArgs);

    total = Number(countResult[0].count);
    page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));

    const selectSql = `
      SELECT
        cr.id, cr.title, cr.description, cr.category,
        cr."budgetMinCents", cr."budgetMaxCents", cr.timeline,
        cr."referenceImageUrls", cr."createdAt",
        cr."isNational",
        cr."buyerId", cr."buyerName", cr."buyerImageUrl",
        CASE
          WHEN cr.lat BETWEEN -90 AND 90 AND cr.lng BETWEEN -180 AND 180
          THEN (6371000 * acos(
            LEAST(1.0, GREATEST(-1.0,
              cos(radians($1)) * cos(radians(LEAST(89.975, GREATEST(-89.975, (floor(cr.lat::float8 * 20.0) + 0.5) / 20.0)))) *
              cos(radians(LEAST(179.975, GREATEST(-179.975, (floor(cr.lng::float8 * 20.0) + 0.5) / 20.0))) - radians($2)) +
              sin(radians($1)) * sin(radians(LEAST(89.975, GREATEST(-89.975, (floor(cr.lat::float8 * 20.0) + 0.5) / 20.0))))
            ))
          ))
          ELSE NULL
        END AS distance_m
      FROM "CommissionRequest" cr
      WHERE cr.status = 'OPEN'
        AND (cr."expiresAt" IS NULL OR cr."expiresAt" > NOW())
        AND cr."buyerAccountActive" = true
        AND NOT (cr."buyerId" = ANY($8::text[]))
        ${categoryConditionSelect}
        AND (
          cr."isNational" = true
          OR (cr.lat BETWEEN -90 AND 90 AND cr.lng BETWEEN -180 AND 180 AND
              6371000 * acos(
                LEAST(1.0, GREATEST(-1.0,
                  cos(radians($3)) * cos(radians(LEAST(89.975, GREATEST(-89.975, (floor(cr.lat::float8 * 20.0) + 0.5) / 20.0)))) *
                  cos(radians(LEAST(179.975, GREATEST(-179.975, (floor(cr.lng::float8 * 20.0) + 0.5) / 20.0))) - radians($4)) +
                  sin(radians($3)) * sin(radians(LEAST(89.975, GREATEST(-89.975, (floor(cr.lat::float8 * 20.0) + 0.5) / 20.0))))
                ))
              ) <= $5
          )
        )
      ORDER BY
        CASE WHEN cr."isNational" = false AND cr.lat IS NOT NULL THEN 0 ELSE 1 END ASC,
        distance_m ASC NULLS LAST,
        cr."createdAt" DESC,
        cr.id DESC
      LIMIT $6 OFFSET $7`;

    const rawResults = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
      description: string;
      category: string | null;
      budgetMinCents: number | null;
      budgetMaxCents: number | null;
      timeline: string | null;
      referenceImageUrls: string[];
      createdAt: Date;
      isNational: boolean;
      buyerId: string;
      buyerName: string | null;
      buyerImageUrl: string | null;
      distance_m: number | null;
    }>>(selectSql, ...((): unknown[] => {
      const args: unknown[] = [viewerLat, viewerLng, viewerLat, viewerLng, radius, pageSize, (page - 1) * pageSize, [...blockedUserIds]];
      if (categoryValid) args.push(categoryFilter);
      return args;
    })());

    const interestCounts = rawResults.length > 0
      ? await publicCommissionInterestCounts(rawResults.map(({ id }) => id), meId)
      : new Map<string, number>();
    requests = rawResults.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category as Category | null,
      budgetMinCents: r.budgetMinCents,
      budgetMaxCents: r.budgetMaxCents,
      timeline: r.timeline,
      referenceImageUrls: r.referenceImageUrls,
      interestedCount: interestCounts.get(r.id) ?? 0,
      createdAt: r.createdAt,
      isNational: r.isNational,
      buyer: { name: r.buyerName, imageUrl: r.buyerImageUrl },
      distanceMeters: r.distance_m != null ? Number(r.distance_m) : undefined,
    }));
  } else {
    total = await prisma.commissionRequest.count({ where });
    page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const found = await prisma.commissionRequest.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        budgetMinCents: true,
        budgetMaxCents: true,
        timeline: true,
        referenceImageUrls: true,
        createdAt: true,
        isNational: true,
        buyerName: true,
        buyerImageUrl: true,
      },
    });
    const interestCounts = found.length > 0
      ? await publicCommissionInterestCounts(found.map(({ id }) => id), meId)
      : new Map<string, number>();
    requests = found.map(({ buyerName, buyerImageUrl, ...request }) => ({
      ...request,
      interestedCount: interestCounts.get(request.id) ?? 0,
      buyer: { name: buyerName, imageUrl: buyerImageUrl },
    }));
  }

  const totalPages = Math.ceil(total / pageSize);

  // Load interest set for this seller
  let interestedSet = new Set<string>();
  if (sellerProfileId && requests.length > 0) {
    const interests = await prisma.commissionInterest.findMany({
      where: {
        sellerProfileId,
        commissionRequestId: { in: requests.map((r) => r.id) },
      },
      select: { commissionRequestId: true },
    });
    interestedSet = new Set(interests.map((i) => i.commissionRequestId));
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

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4 max-[359px]:flex-wrap sm:items-end">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Made together</p>
          <h1 className="font-display text-[clamp(2.25rem,5vw,4.5rem)] font-normal leading-[0.95] tracking-[-0.025em] text-neutral-900">
            Commission Room
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600 sm:text-base">
            Describe a piece you want made. Makers who can build it reach out to you.
          </p>
        </div>
        <CommissionPostButton className="btn btn-sm btn-primary shrink-0 whitespace-nowrap px-3.5 sm:px-5">
          <span className="sm:hidden">Post request</span>
          <span className="hidden sm:inline">Post a Request</span>
        </CommissionPostButton>
      </div>

      {/* How it works explainer */}
      <ol className="mb-8 grid list-none gap-3 p-0 sm:grid-cols-3" aria-label="How the Commission Room works">
        {[
          ["1", "Post what you want", "Share the size, material, budget, timing, and a reference photo if you have one."],
          ["2", "Makers reach out", "Interested makers introduce themselves through Grainline Messages."],
          ["3", "Buy securely", "Choose a maker, agree on the details, and pay through a private Grainline listing."],
        ].map(([number, title, description]) => (
          <li key={number} className="flex gap-3 rounded-lg border border-stone-200/80 bg-white p-4 shadow-[0_12px_30px_-28px_rgba(44,31,26,0.6)]">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#2C1F1A] text-xs font-semibold text-[#FBF8F3]">{number}</span>
            <span className="min-w-0 text-sm leading-5 text-neutral-600">
              <strong className="mb-0.5 block font-medium text-neutral-900">{title}</strong>
              {description}
            </span>
          </li>
        ))}
      </ol>

      {/* Filters */}
      <div className="mb-7 flex flex-col gap-3 border-y border-stone-200/80 py-4 lg:flex-row lg:items-center lg:justify-between">
        <ScrollFadeRow className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

        {/* A lone "All requests" tab looks broken, so this only renders when
            the signed-in maker has a location and Near me is meaningful. */}
        {hasLocation && (
          <div className="shrink-0 self-start lg:self-auto">
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
      </div>

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
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {requests.map((r) => {
            const buyerName = r.buyer.name?.split(" ")[0] ?? "Buyer";
            return (
              <article
                key={r.id}
                className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-stone-200/80 bg-white shadow-[0_14px_34px_-30px_rgba(44,31,26,0.65)] transition-[border-color,box-shadow] hover:border-stone-300 hover:shadow-[0_20px_42px_-30px_rgba(44,31,26,0.72)]"
              >
                {r.referenceImageUrls[0] && (
                  <Link href={`/commission/${r.id}`} className="block aspect-video overflow-hidden bg-[#EFEAE0]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={r.referenceImageUrls[0]}
                      alt="Reference"
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 ease-out motion-reduce:transition-none group-hover:scale-[1.025]"
                    />
                  </Link>
                )}

                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/commission/${r.id}`} className="text-[17px] font-medium leading-snug text-neutral-900 decoration-stone-300 underline-offset-4 hover:underline">
                      {r.title}
                    </Link>
                    {r.category && (
                      <span className="shrink-0 rounded-full bg-[#EFEAE0] px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                        {CATEGORY_LABELS[r.category]}
                      </span>
                    )}
                  </div>

                  <p className="line-clamp-2 text-sm leading-6 text-neutral-600">
                    {truncateTextWithEllipsis(r.description, 200)}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    {formatCommissionBudgetRange(r.budgetMinCents, r.budgetMaxCents) && (
                      <span className="rounded-full border border-stone-200 bg-[#FAF8F4] px-3 py-1 text-xs font-medium text-neutral-800">
                        {formatCommissionBudgetRange(r.budgetMinCents, r.budgetMaxCents)}
                      </span>
                    )}
                    {r.timeline && (
                      <span className="rounded-full border border-stone-200 bg-[#FAF8F4] px-3 py-1 text-xs text-neutral-700">{r.timeline}</span>
                    )}
                    {!r.isNational && commissionDistanceBucket(r.distanceMeters) && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs text-green-700">
                        <MapPin size={11} /> {commissionDistanceBucket(r.distanceMeters)}
                      </span>
                    )}
                    {!r.isNational && r.distanceMeters == null && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs text-green-700">
                        <MapPin size={11} /> Local request
                      </span>
                    )}
                    {r.isNational && (
                      <span className="rounded-full border border-stone-200 bg-[#FAF8F4] px-3 py-1 text-xs text-neutral-700">Open to all makers</span>
                    )}
                  </div>

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-500">
                      {r.buyer.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.buyer.imageUrl} alt={buyerName} className="size-5 rounded-full object-cover" />
                      ) : (
                        <span aria-hidden="true" className="size-5 rounded-full bg-neutral-200" />
                      )}
                      <span className="truncate">{buyerName} · {timeAgo(r.createdAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="whitespace-nowrap">{r.interestedCount} interested</span>
                    </span>

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
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav aria-label="Commission request pages" className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {page > 1 && (
            <Link href={buildHref({ page: String(page - 1) })} className="btn btn-sm btn-secondary">
              ← Previous
            </Link>
          )}
          <span className="inline-flex min-h-9 items-center rounded-md bg-[#EFEAE0] px-4 py-2 text-sm text-neutral-600">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={buildHref({ page: String(page + 1) })} className="btn btn-sm btn-secondary">
              Next →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
