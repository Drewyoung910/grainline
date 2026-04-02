// src/app/blog/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import type { Metadata } from "next";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";
import { BlogPostType, BlogPostStatus, Prisma } from "@prisma/client";
import NewsletterSignup from "@/components/NewsletterSignup";
import { auth } from "@clerk/nextjs/server";
import SaveBlogButton from "@/components/SaveBlogButton";
import BlogSearchBar from "@/components/BlogSearchBar";

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
  searchParams: Promise<{ type?: string; page?: string; bq?: string; tags?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.bq?.trim() ?? "";
  const typeFilter = sp.type ?? "";
  const tagsFilter = sp.tags ? sp.tags.split(",").filter(Boolean) : [];
  const sort = sp.sort ?? (q ? "relevant" : "newest");
  const page = Math.max(1, parseInt(sp.page ?? "1", 10));
  const pageSize = 12;
  const skip = (page - 1) * pageSize;

  const typeValid = typeFilter && (Object.values(BlogPostType) as string[]).includes(typeFilter);

  // Base where clause (type + tag filters apply always)
  const baseFilters = {
    ...(typeValid ? { type: typeFilter as BlogPostType } : {}),
    ...(tagsFilter.length > 0 ? { tags: { hasSome: tagsFilter } } : {}),
  };

  type PostSelect = {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    coverImageUrl: string | null;
    type: BlogPostType;
    tags: string[];
    readingTimeMinutes: number | null;
    publishedAt: Date | null;
    authorType: string;
    author: { name: string | null; imageUrl: string | null };
    sellerProfile: { displayName: string; avatarImageUrl: string | null } | null;
  };

  const POST_SELECT = {
    id: true, slug: true, title: true, excerpt: true, coverImageUrl: true, type: true,
    tags: true, readingTimeMinutes: true, publishedAt: true, authorType: true,
    author: { select: { name: true, imageUrl: true } },
    sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
  } as const;

  let allPosts: PostSelect[] = [];
  let total = 0;

  if (q && sort === "relevant") {
    // GIN full-text ranked search
    type RankedRow = { id: string };
    const rankedRows = await prisma.$queryRaw<RankedRow[]>`
      SELECT id FROM "BlogPost"
      WHERE status = 'PUBLISHED'
        AND to_tsvector('english',
          coalesce(title, '') || ' ' || coalesce(excerpt, '') || ' ' || coalesce(body, '')
        ) @@ plainto_tsquery('english', ${q})
      ORDER BY ts_rank(
        to_tsvector('english',
          coalesce(title, '') || ' ' || coalesce(excerpt, '') || ' ' || coalesce(body, '')
        ),
        plainto_tsquery('english', ${q})
      ) DESC
      LIMIT 500
    `;
    const rankedIds = rankedRows.map((r) => r.id);

    if (rankedIds.length > 0) {
      const fetched = await prisma.blogPost.findMany({
        where: { id: { in: rankedIds }, ...baseFilters },
        select: POST_SELECT,
      });
      const byId = new Map(fetched.map((p) => [p.id, p as PostSelect]));
      const ordered = rankedIds.map((id) => byId.get(id)).filter((p): p is PostSelect => !!p);
      total = ordered.length;
      allPosts = ordered.slice(skip, skip + pageSize);
    }
  } else {
    // Standard sort
    const where: Prisma.BlogPostWhereInput = {
      status: BlogPostStatus.PUBLISHED,
      ...baseFilters,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { excerpt: { contains: q, mode: "insensitive" } },
              { tags: { hasSome: [q.toLowerCase()] } },
            ],
          }
        : {}),
    };
    const orderBy = sort === "alpha" ? { title: "asc" as const } : { publishedAt: "desc" as const };
    [allPosts, total] = await Promise.all([
      prisma.blogPost.findMany({ where, orderBy, skip, take: pageSize, select: POST_SELECT }) as Promise<PostSelect[]>,
      prisma.blogPost.count({ where }),
    ]);
  }

  const featured = !q && page === 1 && tagsFilter.length === 0 ? allPosts[0] ?? null : null;
  const rest = featured ? allPosts.slice(1) : allPosts;
  const totalPages = q ? Math.ceil(total / pageSize) : Math.ceil(total / pageSize);

  // Tag cloud — only when no active search
  let tagCloud: Array<{ tag: string; count: number }> = [];
  if (!q && tagsFilter.length === 0) {
    const rows = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
      SELECT unnest(tags) as tag, COUNT(*) as count
      FROM "BlogPost"
      WHERE status = 'PUBLISHED'
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 20
    `;
    tagCloud = rows.map((r) => ({ tag: r.tag, count: Number(r.count) }));
  }

  // Saved set for logged-in users
  const { userId } = await auth();
  let savedSet = new Set<string>();
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    if (me) {
      const allIds = allPosts.map((p) => p.id);
      if (featured) allIds.push(featured.id);
      const saved = await prisma.savedBlogPost.findMany({
        where: { userId: me.id, blogPostId: { in: allPosts.map((p) => p.id) } },
        select: { blogPostId: true },
      });
      savedSet = new Set(saved.map((s) => s.blogPostId));
    }
  }

  function buildHref(overrides: Record<string, string>) {
    const p = new URLSearchParams();
    if (typeFilter) p.set("type", typeFilter);
    if (q) p.set("bq", q);
    if (tagsFilter.length) p.set("tags", tagsFilter.join(","));
    if (sort && sort !== "newest") p.set("sort", sort);
    if (page > 1) p.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    const qs = p.toString();
    return `/blog${qs ? `?${qs}` : ""}`;
  }

  // Tag cloud size tiers
  const maxTagCount = tagCloud.length > 0 ? Math.max(...tagCloud.map((t) => t.count)) : 1;
  function tagSizeClass(count: number) {
    const ratio = count / maxTagCount;
    if (ratio > 0.66) return "text-sm font-medium text-neutral-800";
    if (ratio > 0.33) return "text-xs text-neutral-700";
    return "text-xs text-neutral-500";
  }

  const isSearching = q || tagsFilter.length > 0;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16">
      {/* Hero */}
      <section className="py-12 sm:py-16 text-center bg-gradient-to-b from-amber-50 to-white -mx-4 sm:-mx-6 px-4 sm:px-6 mb-8">
        <h1 className="text-4xl sm:text-5xl font-bold font-display text-neutral-900 mb-3">
          Stories from the Workshop
        </h1>
        <p className="text-lg text-neutral-600 max-w-xl mx-auto mb-6">
          Maker spotlights, build guides, wood education, and inspiration from the Grainline community.
        </p>
        {/* Search bar */}
        <div className="max-w-xl mx-auto">
          <BlogSearchBar initialQ={q} />
        </div>
      </section>

      {/* Filter tabs + sort */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
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

        {/* Sort dropdown — only show when searching */}
        {q && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-neutral-500">Sort:</span>
            {(["relevant", "newest", "alpha"] as const).map((s) => (
              <Link
                key={s}
                href={buildHref({ sort: s, page: "" })}
                className={`text-sm px-2 py-1 rounded border transition-colors ${
                  sort === s
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                {s === "relevant" ? "Most Relevant" : s === "newest" ? "Newest" : "A–Z"}
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Active tag filter chips */}
      {tagsFilter.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {tagsFilter.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 text-xs px-3 py-1 rounded-full">
              #{tag}
              <Link
                href={buildHref({ tags: tagsFilter.filter((t) => t !== tag).join(","), page: "" })}
                className="hover:text-amber-900 ml-0.5"
                aria-label={`Remove tag ${tag}`}
              >
                ×
              </Link>
            </span>
          ))}
          <Link href={buildHref({ tags: "", page: "" })} className="text-xs text-neutral-500 hover:underline self-center">
            Clear all
          </Link>
        </div>
      )}

      {/* Search results header */}
      {isSearching && (
        <div className="mb-5 text-sm text-neutral-500">
          {q && (
            <span>
              {total} result{total !== 1 ? "s" : ""} for{" "}
              <span className="font-medium text-neutral-800">&ldquo;{q}&rdquo;</span>
              {typeValid && (
                <span> in <span className="font-medium text-neutral-800">{BLOG_TYPE_LABELS[typeFilter as BlogPostType]}</span></span>
              )}
            </span>
          )}
          {!q && tagsFilter.length > 0 && (
            <span>{total} post{total !== 1 ? "s" : ""} tagged {tagsFilter.map((t) => `#${t}`).join(", ")}</span>
          )}
        </div>
      )}

      {allPosts.length === 0 ? (
        <div className="rounded-xl border p-12 text-center">
          <p className="text-neutral-500 mb-4">
            {q ? `No posts found for "${q}"` : "No posts yet — check back soon."}
          </p>
          {q && tagCloud.length > 0 && (
            <>
              <p className="text-sm text-neutral-400 mb-4">Try browsing by topic →</p>
              <div className="flex flex-wrap justify-center gap-2">
                {tagCloud.slice(0, 10).map((t) => (
                  <Link
                    key={t.tag}
                    href={buildHref({ tags: t.tag, bq: "", page: "" })}
                    className="border rounded-full px-3 py-1 text-xs text-neutral-600 hover:bg-neutral-50"
                  >
                    #{t.tag}
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Featured post (only on first page, no search, no tag filter) */}
          {featured && (
            <Link
              href={`/blog/${featured.slug}`}
              className="group block mb-10 rounded-2xl border overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="md:flex">
                <div className="md:w-1/2 h-56 md:h-auto bg-neutral-100 overflow-hidden">
                  {featured.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={featured.coverImageUrl}
                      alt={featured.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
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
                  <h2 className="text-2xl font-bold text-neutral-900 group-hover:underline underline-offset-2">
                    {featured.title}
                  </h2>
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
                        {new Date(featured.publishedAt).toLocaleDateString(undefined, {
                          month: "short", day: "numeric", year: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          )}

          {/* Post grid */}
          {rest.length > 0 && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mb-10">
              {rest.map((post) => {
                const avatar = post.sellerProfile?.avatarImageUrl ?? post.author.imageUrl;
                const name = post.sellerProfile?.displayName ?? post.author.name ?? "Staff";
                const excerpt = post.excerpt
                  ? post.excerpt.slice(0, 120) + (post.excerpt.length > 120 ? "…" : "")
                  : null;
                return (
                  <li key={post.id} className="relative card-listing">
                    <div className="absolute top-2 right-2 z-10">
                      <SaveBlogButton slug={post.slug} initialSaved={savedSet.has(post.id)} />
                    </div>
                    <Link href={`/blog/${post.slug}`} className="block">
                      <div className="h-44 bg-neutral-100 overflow-hidden">
                        {post.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={post.coverImageUrl}
                            alt={post.title}
                            className="w-full h-full object-cover"
                          />
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
                              {new Date(post.publishedAt).toLocaleDateString(undefined, {
                                month: "short", day: "numeric",
                              })}
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
                <Link
                  href={buildHref({ page: String(page - 1) })}
                  className="rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50"
                >
                  ← Previous
                </Link>
              )}
              <span className="rounded-lg border px-4 py-2 text-sm bg-neutral-50 text-neutral-500">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={buildHref({ page: String(page + 1) })}
                  className="rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50"
                >
                  Next →
                </Link>
              )}
            </div>
          )}
        </>
      )}

      {/* Browse by Topic tag cloud — only shown when not searching */}
      {!isSearching && tagCloud.length > 0 && (
        <section className="mb-12 pt-8 border-t">
          <h2 className="text-lg font-semibold text-neutral-800 mb-4">Browse by Topic</h2>
          <div className="flex flex-wrap gap-2">
            {tagCloud.map((t) => (
              <Link
                key={t.tag}
                href={buildHref({ tags: t.tag, page: "" })}
                className={`border border-neutral-200 rounded-full px-3 py-1 hover:bg-neutral-50 transition-colors ${tagSizeClass(t.count)}`}
              >
                #{t.tag}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Newsletter */}
      <NewsletterSignup />
    </main>
  );
}
