// src/app/account/following/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import FollowButton from "@/components/FollowButton";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";
import { publicListingWhere } from "@/lib/listingVisibility";
import { visibleSellerProfileWhere } from "@/lib/sellerVisibility";
import { avatarInitial } from "@/lib/avatarInitials";
import { formatCurrencyCents } from "@/lib/money";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";

export const metadata: Metadata = {
  title: "Makers You Follow",
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 20;

export default async function FollowingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account/following");

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) redirect("/sign-in");

  const { page: pageParam } = await searchParams;
  const requestedPage = parseBoundedPositiveIntParam(pageParam, 1, 1000);
  const totalFollows = await prisma.follow.count({
    where: {
      followerId: me.id,
      sellerProfile: visibleSellerProfileWhere(),
    },
  });
  const totalPages = Math.max(1, Math.ceil(totalFollows / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const follows = await prisma.follow.findMany({
    where: {
      followerId: me.id,
      sellerProfile: visibleSellerProfileWhere(),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true,
      createdAt: true,
      sellerProfile: {
        select: {
          id: true,
          displayName: true,
          tagline: true,
          avatarImageUrl: true,
          city: true,
          state: true,
          vacationMode: true,
          vacationReturnDate: true,
          guildLevel: true,
          user: { select: { imageUrl: true } },
          _count: { select: { followers: true, listings: { where: publicListingWhere() } } },
          listings: {
            where: publicListingWhere(),
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 1,
            select: {
              id: true,
              title: true,
              priceCents: true,
              currency: true,
              photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
            },
          },
        },
      },
    },
  });

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/account" className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-flex items-center gap-1">
        ← My Account
      </Link>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-display">Makers You Follow</h1>
        <Link
          href="/account/feed"
          className="inline-flex min-h-[38px] items-center rounded-md bg-[#2C1F1A] px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3A2A24]"
        >
          View Feed →
        </Link>
      </div>

      {follows.length === 0 ? (
        <div className="card-section p-10 text-center space-y-4">
          <p className="text-neutral-500">You&apos;re not following any makers yet.</p>
          <Link href="/map" className="inline-flex min-h-[40px] items-center rounded-md bg-[#2C1F1A] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#3A2A24]">
            Find Makers to Follow
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {follows.map(({ sellerProfile: s, createdAt }) => {
            const avatar = s.avatarImageUrl ?? s.user?.imageUrl ?? null;
            const location = [s.city, s.state].filter(Boolean).join(", ");
            return (
              <li key={s.id} className="card-section flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
                <div className="flex min-w-0 flex-1 gap-3">
                  <Link href={publicSellerPath(s.id, s.displayName)} className="flex-none">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt={s.displayName ?? ""} className="h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-500 text-xl font-bold">
                        {avatarInitial(s.displayName, "?")}
                      </div>
                    )}
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link href={publicSellerPath(s.id, s.displayName)} className="font-semibold text-neutral-900 hover:underline">
                      {s.displayName ?? "Maker"}
                    </Link>
                    {s.tagline && <p className="text-sm text-neutral-500 line-clamp-2">{s.tagline}</p>}
                    {s.vacationMode && (
                      <div className="mt-1">
                        <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          On vacation
                          {s.vacationReturnDate
                            ? ` until ${s.vacationReturnDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            : ""}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-500 flex-wrap">
                      {location && <span>{location}</span>}
                      {location && <span>·</span>}
                      <span>{s._count.followers} follower{s._count.followers !== 1 ? "s" : ""}</span>
                      <span>·</span>
                      <span>{s._count.listings} listing{s._count.listings !== 1 ? "s" : ""}</span>
                      <span>·</span>
                      <span>Since {new Date(createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
                    </div>
                    {/* Latest listing */}
                    {s.listings[0] ? (
                      <Link href={publicListingPath(s.listings[0].id, s.listings[0].title)} className="flex max-w-full items-center gap-2 mt-2 group w-fit">
                        {s.listings[0].photos[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.listings[0].photos[0].url} alt={s.listings[0].title} className="h-10 w-10 object-cover border border-neutral-200 rounded-md shrink-0" />
                        ) : (
                          <div className="h-10 w-10 bg-neutral-100 border border-neutral-200 rounded-md shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-neutral-800 truncate group-hover:underline">{s.listings[0].title}</p>
                          <p className="text-xs text-neutral-500">
                            {formatCurrencyCents(s.listings[0].priceCents, s.listings[0].currency)}
                          </p>
                        </div>
                      </Link>
                    ) : (
                      <p className="text-xs text-neutral-500 mt-2">No active listings</p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 justify-end sm:pt-1">
                  <FollowButton
                    sellerProfileId={s.id}
                    initialFollowing={true}
                    initialCount={s._count.followers}
                    size="sm"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          {page > 1 && (
            <Link
              href={`/account/following?page=${page - 1}`}
              className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-neutral-600">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/account/following?page=${page + 1}`}
              className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
