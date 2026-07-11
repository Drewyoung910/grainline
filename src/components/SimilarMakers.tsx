// src/components/SimilarMakers.tsx
// Server component: "More makers near {place}" row for listing detail pages.
// Scope comes from the LISTING's maker (same metro first, then same state) —
// it never depends on the buyer's location, so signed-out and no-location
// viewers see it too. Cards are single links (no nested interactive
// elements), so guild status renders as a text pill, not the GuildBadge
// popover button.
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import MediaImage from "@/components/MediaImage";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { publicListingWhere } from "@/lib/listingVisibility";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { publicSellerPath } from "@/lib/publicPaths";
import { avatarInitial } from "@/lib/avatarInitials";

const MAX_SIMILAR_MAKERS = 4;

const similarMakerSelect = {
  id: true,
  displayName: true,
  tagline: true,
  city: true,
  state: true,
  guildLevel: true,
  avatarImageUrl: true,
  bannerImageUrl: true,
  user: { select: { imageUrl: true } },
  listings: {
    where: publicListingWhere(),
    orderBy: [{ qualityScore: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
    },
  },
} satisfies Prisma.SellerProfileSelect;

export default async function SimilarMakers({
  sellerId,
  metroId,
  cityMetroId,
  metroName,
  city,
  state,
  blockedUserIds = [],
}: {
  /** The listing's seller — always excluded from results. */
  sellerId: string;
  metroId: string | null;
  cityMetroId: string | null;
  metroName: string | null;
  city: string | null;
  state: string | null;
  /** Blocked USER ids for the current viewer (either direction). */
  blockedUserIds?: string[];
}) {
  const baseWhere = (extra: Record<string, unknown>) =>
    activeSellerProfileWhere({
      id: { not: sellerId },
      ...(blockedUserIds.length > 0 ? { userId: { notIn: blockedUserIds } } : {}),
      listings: { some: publicListingWhere() },
      ...extra,
    });
  const orderBy = [
    { guildLevel: "desc" as const },
    { profileViews: "desc" as const },
    { id: "asc" as const },
  ];

  // Same metro as the listing's maker first (major metro or child city)
  const metroIds = [metroId, cityMetroId].filter((v): v is string => Boolean(v));
  let makers =
    metroIds.length > 0
      ? await prisma.sellerProfile.findMany({
          where: baseWhere({
            OR: [{ metroId: { in: metroIds } }, { cityMetroId: { in: metroIds } }],
          }),
          orderBy,
          take: MAX_SIMILAR_MAKERS,
          select: similarMakerSelect,
        })
      : [];
  let scopeLabel = metroName ?? city;

  // Fill with same-state makers when the metro is thin
  if (makers.length < 2 && state) {
    const found = new Set(makers.map((m) => m.id));
    const stateMakers = await prisma.sellerProfile.findMany({
      where: baseWhere({
        state,
        id: { notIn: [sellerId, ...found] },
      }),
      orderBy,
      take: MAX_SIMILAR_MAKERS - makers.length,
      select: similarMakerSelect,
    });
    if (makers.length === 0 && stateMakers.length > 0) scopeLabel = state;
    makers = [...makers, ...stateMakers];
  }

  if (makers.length === 0) return null;

  const ratings = await getSellerRatingMap(makers.map((m) => m.id));

  return (
    <section className="mb-10">
      <h2 className="font-semibold font-display text-neutral-900 mb-4">
        {scopeLabel ? `More makers near ${scopeLabel}` : "More makers to explore"}
      </h2>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {makers.map((maker) => {
          const rating = ratings.get(maker.id) ?? null;
          const avatar = maker.avatarImageUrl ?? maker.user?.imageUrl ?? null;
          const cover = maker.bannerImageUrl ?? maker.listings[0]?.photos[0]?.url ?? null;
          return (
            <li key={maker.id} className="card-listing group">
              <Link href={publicSellerPath(maker.id, maker.displayName)} className="block">
                <div className="h-20 bg-[#E3DCCB]/60 overflow-hidden">
                  {cover && (
                    <MediaImage
                      src={cover}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      fallbackClassName="h-full w-full bg-[#E3DCCB]/60"
                    />
                  )}
                </div>
                <div className="px-3 pb-3">
                  <div className="relative -mt-5 h-10 w-10 overflow-hidden rounded-full border-[3px] border-[#EFEAE0] ring-1 ring-black/10 bg-white">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="" loading="lazy" width={40} height={40} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-amber-200 text-xs font-bold text-amber-800">
                        {avatarInitial(maker.displayName, "M")}
                      </div>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-neutral-900">
                      {maker.displayName}
                    </span>
                    {(maker.guildLevel === "GUILD_MEMBER" || maker.guildLevel === "GUILD_MASTER") && (
                      <span
                        className={`rounded-full bg-white ring-1 ring-stone-200/60 px-2 py-0.5 text-[10px] font-semibold ${
                          maker.guildLevel === "GUILD_MASTER" ? "text-[#B8960C]" : "text-green-900"
                        }`}
                      >
                        {maker.guildLevel === "GUILD_MASTER" ? "Guild Master" : "Guild Member"}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
                    {rating && rating.count > 0 && (
                      <span>
                        ★ {(Math.round(rating.avg * 10) / 10).toFixed(1)} ({rating.count})
                      </span>
                    )}
                    {(maker.city || maker.state) && (
                      <span className="truncate">
                        {[maker.city, maker.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>
                  {maker.tagline && (
                    <p className="mt-1 line-clamp-2 text-xs text-neutral-600">{maker.tagline}</p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
