// src/app/account/saved/page.tsx
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import Link from "next/link";
import type { Metadata } from "next";
import ClickTracker from "@/components/ClickTracker";
import ListingCard from "@/components/ListingCard";
import SaveBlogButton from "@/components/SaveBlogButton";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Saved",
};

const PAGE_SIZE = 24;

export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/account/saved");

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) redirect("/sign-in");

  const blockedSellerIds = await getBlockedSellerProfileIdsFor(me.id);

  const sp = await searchParams;
  const tab = sp.tab === "posts" ? "posts" : "listings";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));

  const [listingTotal, postTotal] = await Promise.all([
    prisma.favorite.count({ where: { userId: me.id } }),
    prisma.savedBlogPost.count({ where: { userId: me.id } }),
  ]);

  function tabHref(t: string) {
    return `/account/saved?tab=${t}`;
  }

  if (tab === "listings") {
    const totalPages = Math.ceil(listingTotal / PAGE_SIZE);
    const favorites = await prisma.favorite.findMany({
      where: { userId: me.id, ...(blockedSellerIds.length > 0 ? { listing: { sellerId: { notIn: blockedSellerIds } } } : {}) },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        listing: {
          select: {
            id: true,
            title: true,
            priceCents: true,
            currency: true,
            status: true,
            listingType: true,
            stockQuantity: true,
            seller: {
              select: {
                id: true,
                displayName: true,
                avatarImageUrl: true,
                guildLevel: true,
                city: true,
                state: true,
                acceptingNewOrders: true,
                userId: true,
                user: { select: { imageUrl: true } },
              },
            },
            photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
          },
        },
      },
    });

    return (
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Saved</h1>
        <Tabs tab={tab} tabHref={tabHref} listingTotal={listingTotal} postTotal={postTotal} />

        {favorites.length === 0 ? (
          <div className="rounded-xl border p-10 text-center text-neutral-500">
            Nothing saved yet — start hearting pieces you love while browsing.
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {favorites.map(({ listing: l }) => {
                if (!l) return null;
                return (
                  <ClickTracker key={l.id} listingId={l.id}>
                    <ListingCard
                      listing={{
                        id: l.id,
                        title: l.title,
                        priceCents: l.priceCents,
                        currency: l.currency,
                        status: l.status,
                        listingType: l.listingType,
                        stockQuantity: l.stockQuantity ?? null,
                        photoUrl: l.photos[0]?.url ?? null,
                        seller: {
                          id: l.seller.id,
                          displayName: l.seller.displayName ?? null,
                          avatarImageUrl: l.seller.avatarImageUrl ?? l.seller.user?.imageUrl ?? null,
                          guildLevel: l.seller.guildLevel ?? null,
                          city: l.seller.city ?? null,
                          state: l.seller.state ?? null,
                          acceptingNewOrders: l.seller.acceptingNewOrders ?? null,
                        },
                        rating: null,
                      }}
                      initialSaved={true}
                      variant="grid"
                    />
                  </ClickTracker>
                );
              })}
            </ul>
            <Pagination page={page} totalPages={totalPages} baseHref={tabHref("listings")} />
          </>
        )}
      </main>
    );
  }

  // Posts tab
  const totalPages = Math.ceil(postTotal / PAGE_SIZE);
  const savedPosts = await prisma.savedBlogPost.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      blogPost: {
        select: {
          id: true,
          slug: true,
          title: true,
          excerpt: true,
          coverImageUrl: true,
          type: true,
          readingTimeMinutes: true,
          publishedAt: true,
          author: { select: { name: true, imageUrl: true } },
          sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
        },
      },
    },
  });

  return (
    <main className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">Saved</h1>
      <Tabs tab={tab} tabHref={tabHref} listingTotal={listingTotal} postTotal={postTotal} />

      {savedPosts.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-neutral-500">
          No saved posts yet — bookmark posts from the blog to read later.
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {savedPosts.map(({ blogPost: p }) => {
              if (!p) return null;
              const avatar = p.sellerProfile?.avatarImageUrl ?? p.author.imageUrl;
              const name = p.sellerProfile?.displayName ?? p.author.name ?? "Staff";
              return (
                <li key={p.id} className="relative rounded-xl border overflow-hidden hover:shadow-sm transition-shadow">
                  <div className="absolute top-2 right-2 z-10">
                    <SaveBlogButton slug={p.slug} initialSaved={true} />
                  </div>
                  <Link href={`/blog/${p.slug}`} className="block">
                    <div className="h-44 bg-neutral-100 overflow-hidden">
                      {p.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.coverImageUrl} alt={p.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                      )}
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[p.type]}`}>
                          {BLOG_TYPE_LABELS[p.type]}
                        </span>
                        {p.readingTimeMinutes && (
                          <span className="text-xs text-neutral-400">{p.readingTimeMinutes} min</span>
                        )}
                      </div>
                      <h3 className="font-semibold text-neutral-900 line-clamp-2">{p.title}</h3>
                      {p.excerpt && <p className="text-sm text-neutral-500 line-clamp-2">{p.excerpt.slice(0, 100)}</p>}
                      <div className="flex items-center gap-1.5 pt-1">
                        {avatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={avatar} alt={name} className="h-5 w-5 rounded-full object-cover" />
                        ) : (
                          <div className="h-5 w-5 rounded-full bg-neutral-200" />
                        )}
                        <span className="text-xs text-neutral-500">{name}</span>
                        {p.publishedAt && (
                          <span className="text-xs text-neutral-400 ml-auto">
                            {new Date(p.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} totalPages={totalPages} baseHref={tabHref("posts")} />
        </>
      )}
    </main>
  );
}

function Tabs({
  tab,
  tabHref,
  listingTotal,
  postTotal,
}: {
  tab: string;
  tabHref: (t: string) => string;
  listingTotal: number;
  postTotal: number;
}) {
  return (
    <div className="flex gap-1 mb-6 border-b">
      {(["listings", "posts"] as const).map((t) => {
        const label = t === "listings" ? `Listings (${listingTotal})` : `Blog Posts (${postTotal})`;
        const active = tab === t;
        return (
          <Link
            key={t}
            href={tabHref(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              active
                ? "border-neutral-900 text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  baseHref,
}: {
  page: number;
  totalPages: number;
  baseHref: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex justify-center gap-2 mt-8">
      {page > 1 && (
        <Link href={`${baseHref}&page=${page - 1}`} className="rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50">
          ← Previous
        </Link>
      )}
      <span className="rounded-lg border px-4 py-2 text-sm bg-neutral-50 text-neutral-500">
        Page {page} of {totalPages}
      </span>
      {page < totalPages && (
        <Link href={`${baseHref}&page=${page + 1}`} className="rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50">
          Next →
        </Link>
      )}
    </div>
  );
}
