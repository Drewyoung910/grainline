// src/app/commission/[param]/page.tsx
// Single route handles both:
//   /commission/[metroSlug] — e.g. /commission/austin-tx  (metro commissions page)
//   /commission/[id]        — e.g. /commission/cmabc123   (commission detail page)
// isMetroSlug() distinguishes the two cases.

import { prisma } from "@/lib/db";
import { userClerkCommissionContext, userIdByClerkId } from "@/lib/userIdentityAccess";
import { notFound } from "next/navigation";
import { truncateText } from "@/lib/sanitize";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { CATEGORY_LABELS } from "@/lib/categories";
import GuildBadge from "@/components/GuildBadge";
import type { GuildLevelValue } from "@/components/GuildBadge";
import CommissionInterestButton from "../CommissionInterestButton";
import MarkStatusButtons from "./MarkStatusButtons";
import { ImageLightbox } from "@/components/ImageLightbox";
import { isMetroSlug } from "@/lib/geo-metro";
import { safeJsonLd } from "@/lib/json-ld";
import { closedCommissionLabel } from "@/lib/commissionState";
import {
  publicCommissionInterestCards,
  publicCommissionInterestCounts,
} from "@/lib/commissionInterestCount";
import {
  publicCommissionRequestCount,
  publicCommissionRequestDetail,
  publicCommissionRequestPage,
} from "@/lib/commissionRequestAccess";
import { publicSellerPath } from "@/lib/publicPaths";
import { formatCurrencyMinorUnitAmount } from "@/lib/money";
import { formatCommissionBudgetRange } from "@/lib/commissionBudget";
import { defaultOpenGraphImages } from "@/lib/siteMetadata";
import { displayUsState, formatCityState } from "@/lib/locationDisplay";
import { Suspense } from "react";
import {
  CommissionDetailSkeleton,
  CommissionMetroSkeleton,
} from "@/components/CommissionRouteSkeletons";

const COMMISSION_INTEREST_DISPLAY_LIMIT = 100;

// ---------------------------------------------------------------------------
// generateMetadata
// ---------------------------------------------------------------------------
export async function generateMetadata({
  params,
}: {
  params: Promise<{ param: string }>;
}): Promise<Metadata> {
  const { param } = await params;

  if (isMetroSlug(param)) {
    const metro = await prisma.metro.findUnique({
      where: { slug: param },
      select: { id: true, name: true, state: true, parentMetroId: true },
    });
    if (!metro) notFound();
    const cityName = formatCityState(metro.name, metro.state);
    const openCount = await publicCommissionRequestCount(
      null,
      metro.parentMetroId ? { cityMetroId: metro.id } : { metroId: metro.id },
    );
    const title = `Custom Woodworking Commissions in ${cityName} | Grainline`;
    const description = `Browse open custom woodworking commission requests in ${cityName}. Connect with local buyers looking for handmade furniture, decor, and more.`;
    return {
      title: { absolute: title },
      description,
      robots: openCount === 0 ? { index: false, follow: true } : undefined,
      alternates: { canonical: `https://thegrainline.com/commission/${param}` },
      openGraph: {
        title,
        description,
        url: `https://thegrainline.com/commission/${param}`,
        images: defaultOpenGraphImages(),
      },
    };
  }

  // Commission detail metadata (original logic)
  const req = await publicCommissionRequestDetail(null, param);
  // The page decides who may see a request that is no longer open, so this
  // must not 404 for them. It reveals nothing and stays out of search.
  if (!req) return { title: "Commission request", robots: { index: false, follow: false } };

  const location = req.isNational
    ? "Ships Anywhere"
    : formatCityState(req.buyerSellerCity, req.buyerSellerState) || "Local";

  const title = `${req.title} — ${location} | Custom Woodworking Commission`;

  const budgetParts: string[] = [];
  const metadataBudgetRange = formatCommissionBudgetRange(req.budgetMinCents, req.budgetMaxCents);
  if (metadataBudgetRange) budgetParts.push(`Budget: ${metadataBudgetRange}`);
  const interestCounts = await publicCommissionInterestCounts([param], null);
  const interestedCount = interestCounts.get(param) ?? 0;
  const interested = interestedCount > 0 ? `${interestedCount} maker${interestedCount !== 1 ? "s" : ""} interested.` : "";
  const description = [truncateText(req.description, 120), ...budgetParts, interested]
    .filter(Boolean)
    .join(" ")
  return {
    title,
    description: truncateText(description, 160),
    alternates: { canonical: `https://thegrainline.com/commission/${param}` },
    openGraph: {
      title,
      description: truncateText(description, 160),
      url: `https://thegrainline.com/commission/${param}`,
      images: defaultOpenGraphImages(),
    },
  };
}

// ---------------------------------------------------------------------------
// Metro commissions page
// ---------------------------------------------------------------------------
async function MetroCommissionsPage({ metroSlug }: { metroSlug: string }) {
  const metro = await prisma.metro.findUnique({
    where: { slug: metroSlug },
    select: {
      id: true,
      name: true,
      state: true,
      parentMetroId: true,
      parentMetro: { select: { id: true, slug: true, name: true } },
      childMetros: { select: { id: true, slug: true, name: true } },
    },
  });
  if (!metro) return notFound();

  const isMajorMetro = !metro.parentMetroId;
  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await userIdByClerkId(prisma, userId);
    meId = me?.id ?? null;
  }
  const commissionFilter = isMajorMetro
    ? { metroId: metro.id }
    : { cityMetroId: metro.id };
  const rawCommissions = await publicCommissionRequestPage(meId, {
    ...commissionFilter,
    offset: 0,
    limit: 20,
  });
  const interestCounts = rawCommissions.rows.length > 0
    ? await publicCommissionInterestCounts(rawCommissions.rows.map(({ id }) => id), meId)
    : new Map<string, number>();
  const commissions = rawCommissions.rows.map((commission) => ({
    ...commission,
    interestedCount: interestCounts.get(commission.id) ?? 0,
  }));

  const count = commissions.length;
  const cityName = formatCityState(metro.name, metro.state);
  const stateLabel = displayUsState(metro.state);

  // Nearby areas: siblings + parent (child) or children (major)
  const nearbyMetroIds = isMajorMetro
    ? metro.childMetros.map((c) => c.id)
    : [metro.parentMetroId!, ...metro.childMetros.map((c) => c.id)].filter(Boolean);

  const nearbyWithContent = isMajorMetro
    ? metro.childMetros
    : [metro.parentMetro, ...metro.childMetros].filter(Boolean) as { id: string; slug: string; name: string }[];

  const nearbyFiltered = nearbyWithContent.filter((m) => nearbyMetroIds.includes(m.id));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": `Custom Woodworking Commissions in ${cityName}`,
    "description": `Open commission requests from buyers in ${cityName}`,
    "url": `https://thegrainline.com/commission/${metroSlug}`,
    "numberOfItems": count,
    "itemListElement": commissions.slice(0, 10).map((c, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": c.title,
      "url": `https://thegrainline.com/commission/${c.id}`,
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://thegrainline.com" },
      { "@type": "ListItem", "position": 2, "name": "Commission Room", "item": "https://thegrainline.com/commission" },
      { "@type": "ListItem", "position": 3, "name": metro.name, "item": `https://thegrainline.com/commission/${metroSlug}` },
    ],
  };

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }} />

      {/* Breadcrumb */}
      <nav className="mb-5 text-sm text-neutral-500">
        <Link href="/" className="hover:underline">Home</Link>
        <span className="mx-2">›</span>
        <Link href="/commission" className="hover:underline">Commission Room</Link>
        <span className="mx-2">›</span>
        <span className="text-neutral-500">{stateLabel}</span>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{metro.name}</span>
      </nav>

      <h1 className="font-display text-3xl font-semibold text-neutral-900 mb-2">
        Custom Woodworking Commissions in {cityName}
      </h1>

      {count > 0 ? (
        <p className="text-neutral-600 text-sm mb-8">
          Looking for a custom woodworking commission in {cityName}? Browse {count} active request{count !== 1 ? "s" : ""} from local buyers, or post your own to connect with skilled makers near you.
        </p>
      ) : (
        <p className="text-neutral-600 text-sm mb-8">
          Looking for custom woodworking in {cityName}? Post a commission request and woodworkers can reach out.
        </p>
      )}

      {count === 0 ? (
        <div className="py-6 mb-6">
          <p className="text-neutral-500 mb-4">No open commission requests in {cityName} yet.</p>
          <Link
            href="/commission/new"
            className="btn btn-primary"
          >
            Post a request
          </Link>
        </div>
      ) : (
        <ul className="space-y-4 mb-12">
          {commissions.map((c) => {
            const buyerName = c.buyerName?.split(" ")[0] ?? "Buyer";
            const daysAgo = Math.floor((Date.now() - new Date(c.createdAt).getTime()) / 86400000);
            const timeStr = daysAgo < 1 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
            return (
              <li key={c.id} className="card-section">
                <Link href={`/commission/${c.id}`} className="block p-5 hover:bg-stone-50 transition-colors">
                  <div className="flex items-start gap-4">
                    {c.referenceImageUrls[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.referenceImageUrls[0]} alt="" className="w-16 h-16 rounded-lg object-cover flex-none" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold text-neutral-900 truncate mb-1">{c.title}</h2>
                      <p className="text-sm text-neutral-600 line-clamp-2 mb-2">{c.description}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                        {c.category && <span>{CATEGORY_LABELS[c.category]}</span>}
                        {formatCommissionBudgetRange(c.budgetMinCents, c.budgetMaxCents) && (
                          <span>{formatCommissionBudgetRange(c.budgetMinCents, c.budgetMaxCents)}</span>
                        )}
                        {c.timeline && <span>{c.timeline}</span>}
                        <span>by {buyerName}</span>
                        <span>{timeStr}</span>
                        <span>{c.interestedCount} maker{c.interestedCount !== 1 ? "s" : ""} interested</span>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* The empty state above already carries this CTA. */}
      {count > 0 && (
        <div className="mb-10">
          <Link
            href="/commission/new"
            className="btn btn-primary"
          >
            Post a request
          </Link>
        </div>
      )}

      {/* Nearby areas */}
      {nearbyFiltered.length > 0 && (
        <section className="border-t border-neutral-100 pt-8">
          <h2 className="text-sm font-semibold text-neutral-700 mb-3">Also see commissions in</h2>
          <div className="flex flex-wrap gap-2">
            {nearbyFiltered.map((m) => (
              <Link
                key={m.id}
                href={`/commission/${m.slug}`}
                className="rounded-full bg-[#EFEAE0] px-3 py-1 text-sm font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors"
              >
                {m.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Commission detail page (original logic, param = commission CUID)
// ---------------------------------------------------------------------------
function timeAgo(dateStr: Date | string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function CommissionDetailPage({ id }: { id: string }) {
  const { userId } = await auth();
  let meId: string | null = null;
  let sellerProfileId: string | null = null;

  if (userId) {
    const me = await userClerkCommissionContext(prisma, userId);
    if (me) {
      meId = me.id;
      sellerProfileId = me.sellerProfile?.id ?? null;
    }
  }

  // Fulfilled, closed and expired notices link here, so the buyer who posted
  // the request and the makers who said they were interested can still read
  // it. Everyone else gets a 404.
  const request = await publicCommissionRequestDetail(meId, id);

  if (!request) return notFound();
  const readOnly = request.status !== "OPEN"
    || (request.expiresAt !== null && request.expiresAt.getTime() <= Date.now());
  const [interestCounts, interests] = await Promise.all([
    publicCommissionInterestCounts([request.id], meId),
    publicCommissionInterestCards(request.id, meId, COMMISSION_INTEREST_DISPLAY_LIMIT),
  ]);
  const interestedCount = interestCounts.get(request.id) ?? 0;

  const isOwner = request.isOwner;
  const buyerName = request.buyerName?.split(" ")[0] ?? "Buyer";

  const locationName = request.isNational
    ? "United States"
    : formatCityState(request.buyerSellerCity, request.buyerSellerState) || "United States";

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": `${request.title} — Custom Woodworking Commission`,
    "description": truncateText(request.description, 160),
    "url": `https://thegrainline.com/commission/${request.id}`,
    "provider": { "@type": "Organization", "name": "Grainline", "url": "https://thegrainline.com" },
    "areaServed": { "@type": "Place", "name": locationName },
    "category": "Custom Woodworking",
  };

  const offerData: Record<string, unknown> = {
    "@type": "AggregateOffer",
    "priceCurrency": "USD",
    "offerCount": interestedCount,
  };
  if (request.budgetMinCents) offerData.lowPrice = formatCurrencyMinorUnitAmount(request.budgetMinCents);
  if (request.budgetMaxCents) offerData.highPrice = formatCurrencyMinorUnitAmount(request.budgetMaxCents);
  if (request.budgetMinCents || request.budgetMaxCents) jsonLd.offers = offerData;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      {!readOnly && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      )}
      <div className="mb-5 text-sm text-neutral-500">
        <Link href="/commission" className="hover:underline">Commission Room</Link>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{request.title}</span>
      </div>

      {readOnly && (
        <div className="mb-5 bg-neutral-100 border border-neutral-200 text-neutral-600 text-sm px-4 py-3">
          This request is <strong>{closedCommissionLabel(request)}</strong> and no longer accepting interest.
        </div>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <h1 className="font-display text-2xl font-semibold text-neutral-900 flex-1">{request.title}</h1>
        {sellerProfileId && !isOwner && !readOnly && (
          <CommissionInterestButton
            requestId={request.id}
            initialInterested={request.alreadyInterested}
          />
        )}
        {!userId && !readOnly && (
          <Link
            href={`/sign-in?redirect_url=/commission/${id}`}
            rel="nofollow"
            className="btn btn-primary"
          >
            Sign in to Express Interest
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-neutral-500 mb-6 pb-6 border-b border-neutral-100">
        {request.category && (
          <span className="border border-neutral-200 rounded-full px-3 py-0.5 text-xs">
            {CATEGORY_LABELS[request.category]}
          </span>
        )}
        {formatCommissionBudgetRange(request.budgetMinCents, request.budgetMaxCents) && (
          <span>
            Budget:{" "}
            {formatCommissionBudgetRange(request.budgetMinCents, request.budgetMaxCents)}
          </span>
        )}
        {request.timeline && <span>Timeline: {request.timeline}</span>}
        <span>Posted {timeAgo(request.createdAt)}</span>
        <span>{interestedCount} maker{interestedCount !== 1 ? "s" : ""} interested</span>
      </div>

      {request.referenceImageUrls.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display text-xl text-neutral-900 mb-3">Reference Images</h2>
          <ImageLightbox images={[...request.referenceImageUrls]} thumbnailSize={160} />
        </section>
      )}

      <section className="mb-6">
        <h2 className="font-display text-xl text-neutral-900 mb-2">Request Details</h2>
        <p className="text-sm text-neutral-700 whitespace-pre-wrap">{request.description}</p>
      </section>

      <section className="mb-6 pb-6 border-b border-neutral-100">
        <h2 className="font-display text-xl text-neutral-900 mb-2">Posted by</h2>
        <div className="flex items-center gap-2">
          {request.buyerImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={request.buyerImageUrl} alt={buyerName} className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-neutral-200" />
          )}
          <span className="text-sm text-neutral-700">{buyerName}</span>
        </div>
        {(request.cityMetro ?? request.metro) && (() => {
          const m = request.cityMetro ?? request.metro!;
          return (
            <div className="mt-3">
              <Link href={`/commission/${m.slug}`} className="text-xs text-neutral-500 hover:underline">
                More commissions in {formatCityState(m.name, m.state)} →
              </Link>
            </div>
          );
        })()}
      </section>

      {interests.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display text-xl text-neutral-900 mb-3">
            Interested Maker{interests.length !== 1 ? "s" : ""}
          </h2>
          <div className="flex flex-wrap gap-3">
            {interests.map((interest) => {
              const sp = interest.sellerProfile;
              if (!sp) return null;
              const avatar = sp.avatarImageUrl ?? sp.ownerImageUrl;
              return (
                <Link
                  key={interest.id}
                  href={publicSellerPath(sp.id, sp.displayName)}
                  className="flex items-center gap-2 border border-neutral-200 rounded-full px-3 py-1.5 hover:bg-neutral-50 transition-colors"
                >
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt={sp.displayName} className="w-6 h-6 rounded-full object-cover" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-neutral-200" />
                  )}
                  <span className="text-sm text-neutral-800">{sp.displayName}</span>
                  <GuildBadge level={sp.guildLevel as GuildLevelValue} size={22} showLabel={false} />
                </Link>
              );
            })}
          </div>
          {interestedCount > interests.length && (
            <p className="mt-3 text-xs text-neutral-500">
              Showing the first {interests.length} active maker{interests.length !== 1 ? "s" : ""}.
            </p>
          )}
        </section>
      )}

      {isOwner && !readOnly && (
        <div className="flex gap-3 pt-4 border-t border-neutral-100">
          <MarkStatusButtons requestId={request.id} />
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Unified page — branches on isMetroSlug(param)
// ---------------------------------------------------------------------------
export default async function CommissionParamPage({
  params,
}: {
  params: Promise<{ param: string }>;
}) {
  const { param } = await params;
  if (isMetroSlug(param)) {
    return (
      <Suspense fallback={<CommissionMetroSkeleton />}>
        <MetroCommissionsPage metroSlug={param} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<CommissionDetailSkeleton />}>
      <CommissionDetailPage id={param} />
    </Suspense>
  );
}
