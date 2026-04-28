// src/app/account/following/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import FollowButton from "@/components/FollowButton";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";

export const metadata: Metadata = {
  title: "Makers You Follow",
  robots: { index: false, follow: false },
};

export default async function FollowingPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account/following");

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) redirect("/sign-in");

  const follows = await prisma.follow.findMany({
    where: { followerId: me.id },
    orderBy: { createdAt: "desc" },
    take: 50,
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
          userId: true,
          guildLevel: true,
          user: { select: { imageUrl: true } },
          _count: { select: { followers: true, listings: { where: { status: "ACTIVE", isPrivate: false } } } },
          listings: {
            where: { status: "ACTIVE", isPrivate: false },
            orderBy: { createdAt: "desc" },
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
    <main className="max-w-2xl mx-auto px-4 py-8">
      <Link href="/account" className="text-sm text-neutral-500 hover:text-neutral-700 mb-4 inline-flex items-center gap-1">
        ← My Account
      </Link>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-display">Makers You Follow</h1>
        <Link href="/account/feed" className="text-sm text-amber-700 hover:underline">
          View Feed →
        </Link>
      </div>

      {follows.length === 0 ? (
        <div className="card-section p-10 text-center space-y-4">
          <p className="text-neutral-500">You&apos;re not following any makers yet.</p>
          <Link href="/sellers" className="inline-block bg-amber-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-amber-700 transition-colors">
            Find Makers to Follow
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {follows.map(({ sellerProfile: s, createdAt }) => {
            const avatar = s.avatarImageUrl ?? s.user?.imageUrl ?? null;
            const location = [s.city, s.state].filter(Boolean).join(", ");
            return (
              <li key={s.id} className="card-section p-4 flex items-center gap-4">
                <Link href={publicSellerPath(s.id, s.displayName)} className="flex-none">
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={avatar} alt={s.displayName ?? ""} className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <div className="h-14 w-14 rounded-full bg-neutral-200 flex items-center justify-center text-neutral-400 text-xl font-bold">
                      {(s.displayName ?? "?")[0]?.toUpperCase()}
                    </div>
                  )}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={publicSellerPath(s.id, s.displayName)} className="font-semibold text-neutral-900 hover:underline">
                    {s.displayName ?? "Maker"}
                  </Link>
                  {s.tagline && <p className="text-sm text-neutral-500 truncate">{s.tagline}</p>}
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-400 flex-wrap">
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
                    <Link href={publicListingPath(s.listings[0].id, s.listings[0].title)} className="flex items-center gap-2 mt-2 group w-fit">
                      {s.listings[0].photos[0]?.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.listings[0].photos[0].url} alt={s.listings[0].title} className="h-10 w-10 object-cover border border-neutral-200 shrink-0" />
                      ) : (
                        <div className="h-10 w-10 bg-neutral-100 border border-neutral-200 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-neutral-800 truncate group-hover:underline">{s.listings[0].title}</p>
                        <p className="text-xs text-neutral-500">
                          {(s.listings[0].priceCents / 100).toLocaleString("en-US", { style: "currency", currency: s.listings[0].currency })}
                        </p>
                      </div>
                    </Link>
                  ) : (
                    <p className="text-xs text-neutral-400 mt-2">No active listings</p>
                  )}
                </div>
                <div className="flex-none">
                  <FollowButton
                    sellerProfileId={s.id}
                    sellerUserId={s.userId}
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
    </main>
  );
}
