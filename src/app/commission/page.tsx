// src/app/commission/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { CommissionStatus, Category } from "@prisma/client";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import CommissionInterestButton from "./CommissionInterestButton";

export const metadata: Metadata = {
  title: "Custom Woodworking Commissions — Find a Maker | Grainline",
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
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
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
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: {
        id: true,
        sellerProfile: { select: { id: true, lat: true, lng: true } },
      },
    });
    if (me) {
      meId = me.id;
      sellerProfileId = me.sellerProfile?.id ?? null;
      if (me.sellerProfile?.lat != null) viewerLat = Number(me.sellerProfile.lat);
      if (me.sellerProfile?.lng != null) viewerLng = Number(me.sellerProfile.lng);
    }
  }

  const hasLocation = viewerLat != null && viewerLng != null;

  // Build where clause
  const where = {
    status: CommissionStatus.OPEN,
    ...(categoryValid ? { category: categoryFilter as Category } : {}),
  };

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
    lat: number | null;
    lng: number | null;
    isNational: boolean;
    buyer: { name: string | null; imageUrl: string | null };
    distanceMeters?: number;
  }>;
  let total: number;

  if (tab === "near" && hasLocation) {
    // Near Me: show local requests first, then national ones, filtered by 80km
    const radius = 80000; // 80km
    // Select query params: $1-$7 (viewerLat, viewerLng, viewerLat, viewerLng, radius, pageSize, offset)
    // Category appended as $8 if present — never string-interpolated (SQL injection prevention)
    const categoryConditionSelect = categoryValid ? `AND cr.category::text = $8` : "";
    // Count query params: $1-$3 (viewerLat, viewerLng, radius)
    // Category appended as $4 if present
    const categoryConditionCount = categoryValid ? `AND cr.category::text = $4` : "";

    const selectSql = `
      SELECT
        cr.id, cr.title, cr.description, cr.category,
        cr."budgetMinCents", cr."budgetMaxCents", cr.timeline,
        cr."referenceImageUrls", cr."interestedCount", cr."createdAt",
        cr.lat, cr.lng, cr."isNational",
        u.name AS "buyerName", u."imageUrl" AS "buyerImageUrl",
        CASE
          WHEN cr.lat IS NOT NULL AND cr.lng IS NOT NULL
          THEN (6371000 * acos(
            LEAST(1.0, GREATEST(-1.0,
              cos(radians($1)) * cos(radians(cr.lat)) *
              cos(radians(cr.lng) - radians($2)) +
              sin(radians($1)) * sin(radians(cr.lat))
            ))
          ))
          ELSE NULL
        END AS distance_m
      FROM "CommissionRequest" cr
      JOIN "User" u ON u.id = cr."buyerId"
      WHERE cr.status = 'OPEN'
        ${categoryConditionSelect}
        AND (
          cr."isNational" = true
          OR (cr.lat IS NOT NULL AND cr.lng IS NOT NULL AND
              6371000 * acos(
                LEAST(1.0, GREATEST(-1.0,
                  cos(radians($3)) * cos(radians(cr.lat)) *
                  cos(radians(cr.lng) - radians($4)) +
                  sin(radians($3)) * sin(radians(cr.lat))
                ))
              ) <= $5
          )
        )
      ORDER BY
        CASE WHEN cr."isNational" = false AND cr.lat IS NOT NULL THEN 0 ELSE 1 END ASC,
        distance_m ASC NULLS LAST,
        cr."createdAt" DESC
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
      interestedCount: number;
      createdAt: Date;
      lat: number | null;
      lng: number | null;
      isNational: boolean;
      buyerName: string | null;
      buyerImageUrl: string | null;
      distance_m: number | null;
    }>>(selectSql, ...((): unknown[] => {
      const args: unknown[] = [viewerLat, viewerLng, viewerLat, viewerLng, radius, pageSize, (page - 1) * pageSize];
      if (categoryValid) args.push(categoryFilter);
      return args;
    })());

    const countSql = `
      SELECT COUNT(*) FROM "CommissionRequest" cr
      WHERE cr.status = 'OPEN'
        ${categoryConditionCount}
        AND (
          cr."isNational" = true
          OR (cr.lat IS NOT NULL AND cr.lng IS NOT NULL AND
              6371000 * acos(
                LEAST(1.0, GREATEST(-1.0,
                  cos(radians($1)) * cos(radians(cr.lat)) *
                  cos(radians(cr.lng) - radians($2)) +
                  sin(radians($1)) * sin(radians(cr.lat))
                ))
              ) <= $3
          )
        )`;

    const countArgs: unknown[] = [viewerLat, viewerLng, radius];
    if (categoryValid) countArgs.push(categoryFilter);
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(countSql, ...countArgs);

    total = Number(countResult[0].count);
    requests = rawResults.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category as Category | null,
      budgetMinCents: r.budgetMinCents,
      budgetMaxCents: r.budgetMaxCents,
      timeline: r.timeline,
      referenceImageUrls: r.referenceImageUrls,
      interestedCount: Number(r.interestedCount),
      createdAt: r.createdAt,
      lat: r.lat,
      lng: r.lng,
      isNational: r.isNational,
      buyer: { name: r.buyerName, imageUrl: r.buyerImageUrl },
      distanceMeters: r.distance_m != null ? Number(r.distance_m) : undefined,
    }));
  } else {
    const [found, count] = await Promise.all([
      prisma.commissionRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
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
          interestedCount: true,
          createdAt: true,
          lat: true,
          lng: true,
          isNational: true,
          buyer: { select: { name: true, imageUrl: true } },
        },
      }),
      prisma.commissionRequest.count({ where }),
    ]);
    requests = found;
    total = count;
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
    <main className="max-w-4xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold font-display text-neutral-900">Commission Room</h1>
          <p className="text-neutral-500 mt-1 text-sm">
            Buyers post custom piece requests. Makers express interest to connect.
          </p>
        </div>
        <Link
          href="/commission/new"
          className="rounded-md bg-neutral-900 text-white text-sm px-4 py-2 hover:bg-neutral-700 transition-colors"
        >
          Post a Request
        </Link>
      </div>

      {/* Tab strip */}
      <div className="flex gap-1 mb-6 border-b">
        <Link
          href={buildHref({ tab: "", page: "" })}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === "all"
              ? "border-neutral-900 text-neutral-900"
              : "border-transparent text-neutral-500 hover:text-neutral-700"
          }`}
        >
          All Requests
        </Link>
        {hasLocation && (
          <Link
            href={buildHref({ tab: "near", page: "" })}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === "near"
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-700"
            }`}
          >
            📍 Near Me
          </Link>
        )}
      </div>

      {/* How it works explainer */}
      <div className="bg-amber-50 border border-amber-200/60 rounded-lg p-4 mb-6">
        <h2 className="font-medium text-amber-900 mb-1">How the Commission Room works</h2>
        <p className="text-sm text-amber-800">
          Post a custom piece request describing what you need. Makers browse requests and express interest.
          You review interested makers and connect directly via messages to discuss your project.
        </p>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-6 overflow-x-auto">
        <Link
          href={buildHref({ category: "", page: "" })}
          className={`rounded-full px-3 py-1 text-sm border whitespace-nowrap transition-colors ${
            !categoryFilter ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
          }`}
        >
          All
        </Link>
        {CATEGORY_VALUES.map((cat) => (
          <Link
            key={cat}
            href={buildHref({ category: cat, page: "" })}
            className={`rounded-full px-3 py-1 text-sm border whitespace-nowrap transition-colors ${
              categoryFilter === cat ? "bg-neutral-900 text-white border-neutral-900" : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </Link>
        ))}
      </div>

      {requests.length === 0 ? (
        <div className="border border-neutral-200 p-12 text-center">
          <p className="text-lg font-medium text-neutral-700 mb-2">No commission requests yet</p>
          <p className="text-sm text-neutral-500 mb-6">
            Be the first to post a custom piece request. Describe what you&apos;re looking for
            and makers will reach out directly.
          </p>
          <Link
            href="/commission/new"
            className="inline-block rounded-md bg-neutral-900 text-white px-6 py-2 text-sm hover:bg-neutral-700"
          >
            Post a Request →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => {
            const buyerName = r.buyer.name?.split(" ")[0] ?? "Buyer";
            const isOwn = r.buyer.name && meId ? false : false; // we don't expose buyer userId to avoid leakage
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
                        className="w-16 h-16 object-cover border border-stone-200"
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
                    {(r.budgetMinCents || r.budgetMaxCents) && (
                      <div className="font-semibold text-lg text-amber-700 mb-1">
                        {r.budgetMinCents && r.budgetMaxCents
                          ? `$${(r.budgetMinCents / 100).toFixed(0)}–$${(r.budgetMaxCents / 100).toFixed(0)}`
                          : r.budgetMinCents
                          ? `From $${(r.budgetMinCents / 100).toFixed(0)}`
                          : `Up to $${(r.budgetMaxCents! / 100).toFixed(0)}`}
                      </div>
                    )}

                    <p className="text-sm text-stone-500 line-clamp-2 mb-2">
                      {r.description.slice(0, 200)}{r.description.length > 200 ? "…" : ""}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-stone-400">
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
                      {!r.isNational && r.distanceMeters != null && r.distanceMeters < 80000 && (
                        <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5">
                          📍 {Math.round(r.distanceMeters / 1609)} mi away
                        </span>
                      )}
                      {!r.isNational && r.distanceMeters == null && (
                        <span className="text-xs text-green-700 bg-green-50 border border-green-200 px-2 py-0.5">
                          📍 Local request
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
            <Link href={buildHref({ page: String(page - 1) })} className="border px-4 py-2 text-sm hover:bg-neutral-50">
              ← Previous
            </Link>
          )}
          <span className="border px-4 py-2 text-sm bg-neutral-50 text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={buildHref({ page: String(page + 1) })} className="border px-4 py-2 text-sm hover:bg-neutral-50">
              Next →
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
