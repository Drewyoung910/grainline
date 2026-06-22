import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import ClickTracker from "@/components/ClickTracker";
import ListingCard from "@/components/ListingCard";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { normalizeTag } from "@/lib/tags";
import { getPopularListingTags } from "@/lib/popularTags";
import { publicTagPath } from "@/lib/publicPaths";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";

const BASE_URL = "https://thegrainline.com";
const TAG_PAGE_SIZE = 24;

type TagSearch = {
  page?: string;
};

const TAG_LISTING_SELECT = {
  id: true,
  title: true,
  priceCents: true,
  currency: true,
  status: true,
  listingType: true,
  stockQuantity: true,
  sellerId: true,
  photos: { take: 2, orderBy: { sortOrder: "asc" as const }, select: { url: true, altText: true } },
  seller: {
    select: {
      displayName: true,
      avatarImageUrl: true,
      guildLevel: true,
      city: true,
      state: true,
      acceptingNewOrders: true,
      user: { select: { imageUrl: true } },
    },
  },
} satisfies Prisma.ListingSelect;

type TagListing = Prisma.ListingGetPayload<{ select: typeof TAG_LISTING_SELECT }>;

function decodeRouteSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function tagLabel(tag: string): string {
  return tag
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function tagFromRouteSlug(slug: string): string {
  return normalizeTag(decodeRouteSlug(slug));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<TagSearch>;
}): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const tag = tagFromRouteSlug(slug);
  if (!tag) return {};

  const total = await prisma.listing.count({
    where: publicListingWhere({ tags: { has: tag } }),
  });
  if (total === 0) return { robots: { index: false, follow: true } };

  const page = parseBoundedPositiveIntParam(sp.page, 1, 500);
  const label = tagLabel(tag);
  const pageSuffix = page > 1 ? ` - Page ${page}` : "";
  const title = `Handmade ${label}${pageSuffix} | Grainline`;
  const description = `Shop handmade ${label.toLowerCase()} woodworking from independent makers on Grainline.`;
  const canonical = `${BASE_URL}${publicTagPath(tag)}${page > 1 ? `?page=${page}` : ""}`;

  return {
    title,
    description,
    openGraph: { title, description, url: canonical },
    alternates: { canonical },
  };
}

export default async function TagLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<TagSearch>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const rawSlug = decodeRouteSlug(slug);
  const tag = normalizeTag(rawSlug);
  if (!tag) return notFound();

  const requestedPage = parseBoundedPositiveIntParam(sp.page, 1, 500);
  if (rawSlug !== tag) permanentRedirect(`${publicTagPath(tag)}${requestedPage > 1 ? `?page=${requestedPage}` : ""}`);

  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    meDbId = me?.id ?? null;
  }
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(meDbId);
  const where = publicListingWhere({
    tags: { has: tag },
    ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
  });

  const [total, popularTags] = await Promise.all([
    prisma.listing.count({ where }),
    getPopularListingTags(12),
  ]);

  if (total === 0) return notFound();
  const totalPages = Math.max(1, Math.ceil(total / TAG_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const listings = await prisma.listing.findMany({
    where,
    orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * TAG_PAGE_SIZE,
    take: TAG_PAGE_SIZE,
    select: TAG_LISTING_SELECT,
  });

  let savedSet = new Set<string>();
  if (meDbId && listings.length > 0) {
    const favorites = await prisma.favorite.findMany({
      where: { userId: meDbId, listingId: { in: listings.map((listing) => listing.id) } },
      select: { listingId: true },
    });
    savedSet = new Set(favorites.map((favorite) => favorite.listingId));
  }

  const sellerRatings = await getSellerRatingMap(Array.from(new Set(listings.map((listing) => listing.sellerId))));
  const label = tagLabel(tag);
  const relatedTags = popularTags.filter((popularTag) => popularTag !== tag).slice(0, 8);

  function pageHref(n: number) {
    return `${publicTagPath(tag)}${n > 1 ? `?page=${n}` : ""}`;
  }

  function GridCard({ listing }: { listing: TagListing }) {
    const rating = sellerRatings.get(listing.sellerId);
    return (
      <ClickTracker listingId={listing.id}>
        <ListingCard
          listing={{
            id: listing.id,
            title: listing.title,
            priceCents: listing.priceCents,
            currency: listing.currency,
            status: listing.status,
            listingType: listing.listingType,
            stockQuantity: listing.stockQuantity ?? null,
            photoUrl: listing.photos[0]?.url ?? null,
            photoAltText: listing.photos[0]?.altText ?? null,
            secondPhotoUrl: listing.photos[1]?.url ?? null,
            secondPhotoAltText: listing.photos[1]?.altText ?? null,
            seller: {
              id: listing.sellerId,
              displayName: listing.seller.displayName ?? null,
              avatarImageUrl: listing.seller.avatarImageUrl ?? listing.seller.user?.imageUrl ?? null,
              guildLevel: listing.seller.guildLevel ?? null,
              city: listing.seller.city ?? null,
              state: listing.seller.state ?? null,
              acceptingNewOrders: listing.seller.acceptingNewOrders ?? null,
            },
            rating: rating && rating.count > 0 ? { avg: rating.avg, count: rating.count } : null,
          }}
          initialSaved={savedSet.has(listing.id)}
          variant="grid"
        />
      </ClickTracker>
    );
  }

  return (
    <div className="min-h-[100svh] bg-[#F7F5F0]">
      <main className="mx-auto max-w-[1600px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 border-b border-stone-200/70 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <div className="text-sm text-neutral-500">
              <Link href="/browse" className="hover:underline">Browse</Link>
              <span className="mx-2">/</span>
              <span>{label}</span>
            </div>
            <h1 className="font-display text-3xl font-semibold text-neutral-900 sm:text-4xl">
              Handmade {label}
            </h1>
            <p className="max-w-2xl text-sm text-neutral-600 sm:text-base">
              {total} {total === 1 ? "piece" : "pieces"} tagged #{tag} from active Grainline makers.
            </p>
          </div>
          <Link
            href={`/browse?tag=${encodeURIComponent(tag)}`}
            className="inline-flex w-fit items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
          >
            Open in browse
          </Link>
        </div>

        <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-2 sm:gap-x-4 sm:gap-y-8 lg:grid-cols-3 xl:grid-cols-4">
          {listings.map((listing) => (
            <GridCard key={listing.id} listing={listing} />
          ))}
        </ul>

        {totalPages > 1 && (
          <nav className="mt-10 flex items-center justify-center gap-2 text-sm">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-neutral-700 hover:bg-neutral-50">
                Prev
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-neutral-200 bg-white/60 px-3 py-1.5 text-neutral-500">
                Prev
              </span>
            )}
            <span className="px-2 text-neutral-500">
              Page <span className="font-medium">{page}</span> of {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-neutral-700 hover:bg-neutral-50">
                Next
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-md border border-neutral-200 bg-white/60 px-3 py-1.5 text-neutral-500">
                Next
              </span>
            )}
          </nav>
        )}

        {relatedTags.length > 0 && (
          <section className="mt-12 border-t border-stone-200/70 pt-6">
            <h2 className="font-display text-xl font-semibold text-neutral-900">Explore More Tags</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {relatedTags.map((relatedTag) => (
                <Link
                  key={relatedTag}
                  href={publicTagPath(relatedTag)}
                  className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-amber-50"
                >
                  #{relatedTag}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
