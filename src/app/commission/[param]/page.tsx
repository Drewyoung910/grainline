// src/app/commission/[param]/page.tsx
// Single route handles both:
//   /commission/[metroSlug] — e.g. /commission/austin-tx  (metro commissions page)
//   /commission/[id]        — e.g. /commission/cmabc123   (commission detail page)
// isMetroSlug() distinguishes the two cases.

import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
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
import { CommissionStatus } from "@prisma/client";
import { safeJsonLd } from "@/lib/json-ld";

// ---------------------------------------------------------------------------
// generateStaticParams — include both active metro slugs and open commission IDs
// ---------------------------------------------------------------------------
export async function generateStaticParams() {
  const [metros, commissions] = await Promise.all([
    prisma.metro.findMany({
      where: {
        isActive: true,
        OR: [
          { commissions: { some: { status: CommissionStatus.OPEN } } },
          { commissionCityMetros: { some: { status: CommissionStatus.OPEN } } },
        ],
      },
      select: { slug: true },
    }),
    prisma.commissionRequest.findMany({
      where: { status: CommissionStatus.OPEN },
      select: { id: true },
      take: 500,
    }),
  ]);
  return [
    ...metros.map((m) => ({ param: m.slug })),
    ...commissions.map((c) => ({ param: c.id })),
  ];
}

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
      select: { name: true, state: true },
    });
    if (!metro) return {};
    const title = `Custom Woodworking Commissions in ${metro.name}, ${metro.state} | Grainline`;
    const description = `Browse open custom woodworking commission requests in ${metro.name}, ${metro.state}. Connect with local buyers looking for handmade furniture, decor, and more.`;
    return {
      title,
      description,
      alternates: { canonical: `https://thegrainline.com/commission/${param}` },
      openGraph: { title, description, url: `https://thegrainline.com/commission/${param}` },
    };
  }

  // Commission detail metadata (original logic)
  const req = await prisma.commissionRequest.findUnique({
    where: { id: param },
    select: {
      title: true,
      description: true,
      isNational: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      interestedCount: true,
      buyer: { select: { sellerProfile: { select: { city: true, state: true } } } },
    },
  });
  if (!req) return {};

  const location = req.isNational
    ? "Ships Anywhere"
    : [req.buyer.sellerProfile?.city, req.buyer.sellerProfile?.state].filter(Boolean).join(", ") || "Local";

  const title = `${req.title} — ${location} | Custom Woodworking Commission`;

  const budgetParts: string[] = [];
  if (req.budgetMinCents || req.budgetMaxCents) {
    if (req.budgetMinCents && req.budgetMaxCents) {
      budgetParts.push(`Budget: $${(req.budgetMinCents / 100).toFixed(0)}–$${(req.budgetMaxCents / 100).toFixed(0)}`);
    } else if (req.budgetMinCents) {
      budgetParts.push(`Budget from $${(req.budgetMinCents / 100).toFixed(0)}`);
    } else {
      budgetParts.push(`Budget up to $${(req.budgetMaxCents! / 100).toFixed(0)}`);
    }
  }
  const interested = req.interestedCount > 0 ? `${req.interestedCount} maker${req.interestedCount !== 1 ? "s" : ""} interested.` : "";
  const description = [req.description.slice(0, 120), ...budgetParts, interested]
    .filter(Boolean)
    .join(" ")
    .slice(0, 160);

  return {
    title,
    description,
    alternates: { canonical: `https://thegrainline.com/commission/${param}` },
    openGraph: { title, description, url: `https://thegrainline.com/commission/${param}` },
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

  const commissionWhere = isMajorMetro
    ? { metroId: metro.id, status: CommissionStatus.OPEN }
    : { cityMetroId: metro.id, status: CommissionStatus.OPEN };

  const commissions = await prisma.commissionRequest.findMany({
    where: commissionWhere,
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      timeline: true,
      interestedCount: true,
      createdAt: true,
      referenceImageUrls: true,
      buyer: { select: { name: true, imageUrl: true } },
    },
  });

  const count = commissions.length;
  const cityName = `${metro.name}, ${metro.state}`;

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
      { "@type": "ListItem", "position": 3, "name": metro.state },
      { "@type": "ListItem", "position": 4, "name": metro.name, "item": `https://thegrainline.com/commission/${metroSlug}` },
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
        <span className="text-neutral-400">{metro.state}</span>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{metro.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-neutral-900 mb-2">
        Custom Woodworking Commissions in {cityName}
      </h1>

      {count > 0 ? (
        <p className="text-neutral-600 text-sm mb-8">
          Looking for a custom woodworking commission in {cityName}? Browse {count} active request{count !== 1 ? "s" : ""} from local buyers, or post your own to connect with skilled makers near you.
        </p>
      ) : (
        <p className="text-neutral-600 text-sm mb-8">
          Custom woodworking in {cityName} — makers coming soon. Post a commission request to attract local woodworkers, or sign up to be notified when makers join in your area.
        </p>
      )}

      {count === 0 ? (
        <div className="card-section p-8 text-center mb-10">
          <p className="text-neutral-500 mb-4">No open commission requests in {cityName} yet.</p>
          <Link
            href="/commission/new"
            className="inline-block bg-amber-500 text-white text-sm font-medium px-6 py-2.5 hover:bg-amber-600 transition-colors"
          >
            Post a Commission Request
          </Link>
        </div>
      ) : (
        <ul className="space-y-4 mb-12">
          {commissions.map((c) => {
            const buyerName = c.buyer.name?.split(" ")[0] ?? "Buyer";
            const daysAgo = Math.floor((Date.now() - new Date(c.createdAt).getTime()) / 86400000);
            const timeStr = daysAgo < 1 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
            return (
              <li key={c.id} className="border border-neutral-200">
                <Link href={`/commission/${c.id}`} className="block p-5 hover:bg-stone-50 transition-colors">
                  <div className="flex items-start gap-4">
                    {c.referenceImageUrls[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.referenceImageUrls[0]} alt="" className="w-16 h-16 object-cover flex-none" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold text-neutral-900 truncate mb-1">{c.title}</h2>
                      <p className="text-sm text-neutral-600 line-clamp-2 mb-2">{c.description}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
                        {c.category && <span>{CATEGORY_LABELS[c.category]}</span>}
                        {(c.budgetMinCents || c.budgetMaxCents) && (
                          <span>
                            {c.budgetMinCents && c.budgetMaxCents
                              ? `$${(c.budgetMinCents / 100).toFixed(0)}–$${(c.budgetMaxCents / 100).toFixed(0)}`
                              : c.budgetMinCents
                              ? `From $${(c.budgetMinCents / 100).toFixed(0)}`
                              : `Up to $${(c.budgetMaxCents! / 100).toFixed(0)}`}
                          </span>
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

      <div className="mb-10">
        <Link
          href="/commission/new"
          className="inline-block border border-neutral-900 text-sm font-medium px-6 py-2.5 hover:bg-neutral-900 hover:text-white transition-colors"
        >
          Post a Commission Request
        </Link>
      </div>

      {/* Nearby areas */}
      {nearbyFiltered.length > 0 && (
        <section className="border-t border-neutral-100 pt-8">
          <h2 className="text-sm font-semibold text-neutral-700 mb-3">Also see commissions in</h2>
          <div className="flex flex-wrap gap-2">
            {nearbyFiltered.map((m) => (
              <Link
                key={m.id}
                href={`/commission/${m.slug}`}
                className="text-sm border border-neutral-200 px-3 py-1 hover:bg-neutral-50 transition-colors"
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
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

async function CommissionDetailPage({ id }: { id: string }) {
  const request = await prisma.commissionRequest.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      timeline: true,
      referenceImageUrls: true,
      status: true,
      interestedCount: true,
      isNational: true,
      createdAt: true,
      buyerId: true,
      metroId: true,
      cityMetroId: true,
      metro: { select: { slug: true, name: true, state: true } },
      cityMetro: { select: { slug: true, name: true, state: true } },
      buyer: { select: { name: true, imageUrl: true, sellerProfile: { select: { city: true, state: true } } } },
      interests: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          createdAt: true,
          sellerProfile: {
            select: {
              id: true,
              displayName: true,
              avatarImageUrl: true,
              guildLevel: true,
              user: { select: { imageUrl: true } },
            },
          },
        },
      },
    },
  });

  if (!request) return notFound();

  const { userId } = await auth();
  let meId: string | null = null;
  let sellerProfileId: string | null = null;
  let alreadyInterested = false;

  if (userId) {
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, sellerProfile: { select: { id: true } } },
    });
    if (me) {
      meId = me.id;
      sellerProfileId = me.sellerProfile?.id ?? null;
      if (sellerProfileId) {
        const interest = await prisma.commissionInterest.findUnique({
          where: { commissionRequestId_sellerProfileId: { commissionRequestId: id, sellerProfileId } },
        });
        alreadyInterested = !!interest;
      }
    }
  }

  const isOwner = meId === request.buyerId;
  const buyerName = request.buyer.name?.split(" ")[0] ?? "Buyer";

  const locationName = request.isNational
    ? "United States"
    : [request.buyer.sellerProfile?.city, request.buyer.sellerProfile?.state].filter(Boolean).join(", ") || "United States";

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": `${request.title} — Custom Woodworking Commission`,
    "description": request.description.slice(0, 160),
    "url": `https://thegrainline.com/commission/${request.id}`,
    "provider": { "@type": "Organization", "name": "Grainline", "url": "https://thegrainline.com" },
    "areaServed": { "@type": "Place", "name": locationName },
    "category": "Custom Woodworking",
  };

  const offerData: Record<string, unknown> = {
    "@type": "AggregateOffer",
    "priceCurrency": "USD",
    "offerCount": request.interestedCount,
  };
  if (request.budgetMinCents) offerData.lowPrice = (request.budgetMinCents / 100).toFixed(2);
  if (request.budgetMaxCents) offerData.highPrice = (request.budgetMaxCents / 100).toFixed(2);
  if (request.budgetMinCents || request.budgetMaxCents) jsonLd.offers = offerData;

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <div className="mb-5 text-sm text-neutral-500">
        <Link href="/commission" className="hover:underline">Commission Room</Link>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{request.title}</span>
      </div>

      {request.status !== "OPEN" && (
        <div className="mb-5 bg-neutral-100 border border-neutral-200 text-neutral-600 text-sm px-4 py-3">
          This request is <strong>{request.status.toLowerCase().replace("_", " ")}</strong> and no longer accepting interest.
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-neutral-900 flex-1">{request.title}</h1>
        {sellerProfileId && !isOwner && request.status === "OPEN" && (
          <CommissionInterestButton
            requestId={request.id}
            sellerProfileId={sellerProfileId}
            initialInterested={alreadyInterested}
          />
        )}
        {!userId && request.status === "OPEN" && (
          <Link
            href={`/sign-in?redirect_url=/commission/${id}`}
            className="text-sm border border-neutral-900 px-3 py-1.5 hover:bg-neutral-900 hover:text-white transition-colors"
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
        {(request.budgetMinCents || request.budgetMaxCents) && (
          <span>
            Budget:{" "}
            {request.budgetMinCents && request.budgetMaxCents
              ? `$${(request.budgetMinCents / 100).toFixed(0)}–$${(request.budgetMaxCents / 100).toFixed(0)}`
              : request.budgetMinCents
              ? `From $${(request.budgetMinCents / 100).toFixed(0)}`
              : `Up to $${(request.budgetMaxCents! / 100).toFixed(0)}`}
          </span>
        )}
        {request.timeline && <span>Timeline: {request.timeline}</span>}
        <span>Posted {timeAgo(request.createdAt)}</span>
        <span>{request.interestedCount} maker{request.interestedCount !== 1 ? "s" : ""} interested</span>
      </div>

      <section className="mb-6">
        <h2 className="font-semibold text-neutral-800 mb-2">Request Details</h2>
        <p className="text-sm text-neutral-700 whitespace-pre-wrap">{request.description}</p>
      </section>

      {request.referenceImageUrls.length > 0 && (
        <section className="mb-6">
          <h2 className="font-semibold text-neutral-800 mb-3">Reference Images</h2>
          <ImageLightbox images={request.referenceImageUrls} />
        </section>
      )}

      <section className="mb-6 pb-6 border-b border-neutral-100">
        <h2 className="font-semibold text-neutral-800 mb-2">Posted by</h2>
        <div className="flex items-center gap-2">
          {request.buyer.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={request.buyer.imageUrl} alt={buyerName} className="w-8 h-8 rounded-full object-cover" />
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
                More commissions in {m.name}, {m.state} →
              </Link>
            </div>
          );
        })()}
      </section>

      {request.interests.length > 0 && (
        <section className="mb-6">
          <h2 className="font-semibold text-neutral-800 mb-3">
            {request.interests.length} Interested Maker{request.interests.length !== 1 ? "s" : ""}
          </h2>
          <div className="flex flex-wrap gap-3">
            {request.interests.map((interest) => {
              const sp = interest.sellerProfile;
              if (!sp) return null;
              const avatar = sp.avatarImageUrl ?? sp.user?.imageUrl;
              return (
                <Link
                  key={interest.id}
                  href={`/seller/${sp.id}`}
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
        </section>
      )}

      {isOwner && request.status === "OPEN" && (
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
    return <MetroCommissionsPage metroSlug={param} />;
  }
  return <CommissionDetailPage id={param} />;
}
