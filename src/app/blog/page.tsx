// src/app/blog/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";
import { BlogPostType, BlogPostStatus, Prisma } from "@prisma/client";
import NewsletterSignup from "@/components/NewsletterSignup";

export const metadata: Metadata = {
  title: "Stories from the Workshop",
  description: "Maker spotlights, build guides, wood education, and gift guides from the Grainline community.",
  alternates: { canonical: "https://grainline.co/blog" },
};

const TYPE_TABS: Array<{ label: string; value: string }> = [
  { label: "All", value: "" },
  { label: "Gift Guides", value: "GIFT_GUIDE" },
  { label: "Maker Spotlights", value: "MAKER_SPOTLIGHT" },
  { label: "Behind the Build", value: "BEHIND_THE_BUILD" },
  { label: "Wood Education", value: "WOOD_EDUCATION" },
];

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const typeFilter = sp.type ?? "";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize = 12;

  const where: Prisma.BlogPostWhereInput = { status: BlogPostStatus.PUBLISHED };
  if (typeFilter && Object.keys(BlogPostType).includes(typeFilter)) where.type = typeFilter as BlogPostType;

  const [allPosts, total] = await Promise.all([
    prisma.blogPost.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        coverImageUrl: true,
        type: true,
        readingTimeMinutes: true,
        publishedAt: true,
        authorType: true,
        author: { select: { name: true, imageUrl: true } },
        sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
      },
    }),
    prisma.blogPost.count({ where }),
  ]);

  const featured = page === 1 ? allPosts[0] ?? null : null;
  const rest = page === 1 ? allPosts.slice(1) : allPosts;
  const totalPages = Math.ceil(total / pageSize);

  function buildHref(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (typeFilter) p.set("type", typeFilter);
    if (page > 1) p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    const qs = p.toString();
    return `/blog${qs ? `?${qs}` : ""}`;
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
      {/* Hero */}
      <section className="py-12 sm:py-16 text-center bg-gradient-to-b from-amber-50 to-white -mx-4 sm:-mx-6 px-4 sm:px-6 mb-8">
        <h1 className="text-4xl sm:text-5xl font-bold text-neutral-900 mb-3">
          Stories from the Workshop
        </h1>
        <p className="text-lg text-neutral-600 max-w-xl mx-auto">
          Maker spotlights, build guides, wood education, and inspiration from the Grainline community.
        </p>
      </section>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {TYPE_TABS.map((tab) => {
          const active = typeFilter === tab.value;
          return (
            <Link
              key={tab.value}
              href={buildHref({ type: tab.value, page: "" })}
              className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                active
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      {allPosts.length === 0 ? (
        <div className="rounded-xl border p-12 text-center text-neutral-500">
          No posts yet — check back soon.
        </div>
      ) : (
        <>
          {/* Featured post */}
          {featured && (
            <Link href={`/blog/${featured.slug}`} className="group block mb-10 rounded-2xl border overflow-hidden hover:shadow-md transition-shadow">
              <div className="md:flex">
                <div className="md:w-1/2 h-56 md:h-auto bg-neutral-100 overflow-hidden">
                  {featured.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={featured.coverImageUrl} alt={featured.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-br from-amber-100 to-stone-200" />
                  )}
                </div>
                <div className="md:w-1/2 p-6 sm:p-8 flex flex-col justify-center space-y-3">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[featured.type]}`}>
                      {BLOG_TYPE_LABELS[featured.type]}
                    </span>
                    {featured.readingTimeMinutes && (
                      <span className="text-xs text-neutral-500">{featured.readingTimeMinutes} min read</span>
                    )}
                  </div>
                  <h2 className="text-2xl font-bold text-neutral-900 group-hover:underline underline-offset-2">{featured.title}</h2>
                  {featured.excerpt && (
                    <p className="text-neutral-600 text-sm line-clamp-3">{featured.excerpt}</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    {(() => {
                      const avatar = featured.sellerProfile?.avatarImageUrl ?? featured.author.imageUrl;
                      const name = featured.sellerProfile?.displayName ?? featured.author.name ?? "Staff";
                      return (
                        <>
                          {avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatar} alt={name} className="h-6 w-6 rounded-full object-cover" />
                          ) : (
                            <div className="h-6 w-6 rounded-full bg-neutral-200" />
                          )}
                          <span className="text-xs text-neutral-500">{name}</span>
                        </>
                      );
                    })()}
                    {featured.publishedAt && (
                      <span className="text-xs text-neutral-400 ml-auto">
                        {new Date(featured.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* Grid */}
          {rest.length > 0 && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mb-10">
              {rest.map((post) => {
                const avatar = post.sellerProfile?.avatarImageUrl ?? post.author.imageUrl;
                const name = post.sellerProfile?.displayName ?? post.author.name ?? "Staff";
                const excerpt = post.excerpt ? post.excerpt.slice(0, 120) + (post.excerpt.length > 120 ? "…" : "") : null;
                return (
                  <li key={post.id} className="rounded-xl border overflow-hidden hover:shadow-sm transition-shadow">
                    <Link href={`/blog/${post.slug}`} className="block">
                      <div className="h-44 bg-neutral-100 overflow-hidden">
                        {post.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={post.coverImageUrl} alt={post.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                        )}
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[post.type]}`}>
                            {BLOG_TYPE_LABELS[post.type]}
                          </span>
                          {post.readingTimeMinutes && (
                            <span className="text-xs text-neutral-400">{post.readingTimeMinutes} min</span>
                          )}
                        </div>
                        <h3 className="font-semibold text-neutral-900 line-clamp-2">{post.title}</h3>
                        {excerpt && <p className="text-sm text-neutral-500 line-clamp-2">{excerpt}</p>}
                        <div className="flex items-center gap-1.5 pt-1">
                          {avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatar} alt={name} className="h-5 w-5 rounded-full object-cover" />
                          ) : (
                            <div className="h-5 w-5 rounded-full bg-neutral-200" />
                          )}
                          <span className="text-xs text-neutral-500">{name}</span>
                          {post.publishedAt && (
                            <span className="text-xs text-neutral-400 ml-auto">
                              {new Date(post.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2 mb-12">
              {page > 1 && (
                <Link href={buildHref({ page: String(page - 1) })} className="rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50">
                  ← Previous
                </Link>
              )}
              <span className="rounded-lg border px-4 py-2 text-sm bg-neutral-50 text-neutral-500">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link href={buildHref({ page: String(page + 1) })} className="rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50">
                  Next →
                </Link>
              )}
            </div>
          )}
        </>
      )}

      {/* Newsletter */}
      <NewsletterSignup />
    </main>
  );
}
