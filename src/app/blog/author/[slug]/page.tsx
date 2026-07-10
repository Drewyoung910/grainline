import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import MediaImage from "@/components/MediaImage";
import SaveBlogButton from "@/components/SaveBlogButton";
import { BLOG_TYPE_COLORS, BLOG_TYPE_LABELS } from "@/lib/blog";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { getBlockedUserIdsFor } from "@/lib/blocks";
import { prisma } from "@/lib/db";
import { extractRouteId, publicBlogAuthorPath, publicSellerPath } from "@/lib/publicPaths";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { ownerSavedBlogPostIdRows } from "@/lib/savedBlogPostOwnerAccess";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { truncateTextWithEllipsis } from "@/lib/sanitize";

const BASE_URL = "https://thegrainline.com";
const AUTHOR_POST_PAGE_SIZE = 12;

type AuthorSearch = {
  page?: string;
};

const AUTHOR_POST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  coverImageUrl: true,
  type: true,
  readingTimeMinutes: true,
  publishedAt: true,
} satisfies Prisma.BlogPostSelect;

type AuthorPost = Prisma.BlogPostGetPayload<{ select: typeof AUTHOR_POST_SELECT }>;

const getPublicBlogAuthor = cache(async (sellerProfileId: string) =>
  prisma.sellerProfile.findFirst({
    where: activeSellerProfileWhere({
      id: sellerProfileId,
      blogPosts: { some: publicBlogPostWhere({ sellerProfileId }) },
    }),
    select: {
      id: true,
      displayName: true,
      tagline: true,
      avatarImageUrl: true,
      bannerImageUrl: true,
      user: { select: { id: true, imageUrl: true } },
    },
  })
);

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<AuthorSearch>;
}): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const sellerProfileId = extractRouteId(slug);
  if (!sellerProfileId) return {};

  const author = await getPublicBlogAuthor(sellerProfileId);
  if (!author) return { robots: { index: false, follow: true } };

  const page = parseBoundedPositiveIntParam(sp.page, 1, 500);
  const pageSuffix = page > 1 ? ` - Page ${page}` : "";
  const title = `${author.displayName} Stories${pageSuffix} | Grainline`;
  const description = author.tagline
    ? `Read woodworking stories, guides, and updates from ${author.displayName}: ${author.tagline}`
    : `Read woodworking stories, guides, and updates from ${author.displayName} on Grainline.`;
  const canonical = `${BASE_URL}${publicBlogAuthorPath(author.id, author.displayName)}${page > 1 ? `?page=${page}` : ""}`;
  const image = author.bannerImageUrl ?? author.avatarImageUrl ?? author.user.imageUrl ?? undefined;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: canonical,
      images: image ? [{ url: image }] : [{ url: `${BASE_URL}/og-image.jpg` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image ?? `${BASE_URL}/og-image.jpg`],
    },
    alternates: { canonical },
  };
}

export default async function BlogAuthorPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<AuthorSearch>;
}) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const sellerProfileId = extractRouteId(slug);
  if (!sellerProfileId) return notFound();

  const author = await getPublicBlogAuthor(sellerProfileId);
  if (!author) return notFound();

  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    meDbId = me?.id ?? null;
  }

  if (meDbId) {
    const blockedUserIds = await getBlockedUserIdsFor(meDbId);
    if (blockedUserIds.has(author.user.id)) return notFound();
  }

  const requestedPage = parseBoundedPositiveIntParam(sp.page, 1, 500);
  const canonicalPath = publicBlogAuthorPath(author.id, author.displayName);
  if (`/blog/author/${slug}` !== canonicalPath) {
    permanentRedirect(`${canonicalPath}${requestedPage > 1 ? `?page=${requestedPage}` : ""}`);
  }
  const where = publicBlogPostWhere({ sellerProfileId: author.id });
  const total = await prisma.blogPost.count({ where });

  if (total === 0) return notFound();
  const totalPages = Math.max(1, Math.ceil(total / AUTHOR_POST_PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const posts = await prisma.blogPost.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUTHOR_POST_PAGE_SIZE,
    take: AUTHOR_POST_PAGE_SIZE,
    select: AUTHOR_POST_SELECT,
  });

  let savedSet = new Set<string>();
  if (meDbId && posts.length > 0) {
    const saved = await ownerSavedBlogPostIdRows(meDbId, posts.map((post) => post.id));
    savedSet = new Set(saved.map((savedPost) => savedPost.blogPostId));
  }

  const avatar = author.avatarImageUrl ?? author.user.imageUrl ?? null;

  function pageHref(n: number) {
    return `${canonicalPath}${n > 1 ? `?page=${n}` : ""}`;
  }

  function PostCard({ post }: { post: AuthorPost }) {
    const excerpt = post.excerpt ? truncateTextWithEllipsis(post.excerpt, 140) : null;
    return (
      <li className="card-listing relative">
        <div className="absolute right-2 top-2 z-10">
          <SaveBlogButton slug={post.slug} initialSaved={savedSet.has(post.id)} />
        </div>
        <Link href={`/blog/${post.slug}`} className="block">
          <div className="aspect-[16/9] overflow-hidden bg-neutral-100">
            <MediaImage
              src={post.coverImageUrl}
              alt={post.title}
              className="h-full w-full object-cover"
              fallbackClassName="h-full w-full bg-gradient-to-br from-amber-50 to-stone-100"
            />
          </div>
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[post.type]}`}>
                {BLOG_TYPE_LABELS[post.type]}
              </span>
              {post.readingTimeMinutes && (
                <span className="text-xs text-neutral-500">{post.readingTimeMinutes} min</span>
              )}
            </div>
            <h2 className="line-clamp-2 font-semibold text-neutral-900">{post.title}</h2>
            {excerpt && <p className="line-clamp-2 text-sm text-neutral-500">{excerpt}</p>}
            {post.publishedAt && (
              <div className="text-xs text-neutral-500">
                {new Date(post.publishedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            )}
          </div>
        </Link>
      </li>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-6 text-sm text-neutral-500">
        <Link href="/blog" className="hover:underline">Blog</Link>
        <span className="mx-2">/</span>
        <span>{author.displayName}</span>
      </div>

      <section className="mb-10 border-b border-neutral-100 pb-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatar} alt={author.displayName} className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="h-16 w-16 rounded-full bg-neutral-200" />
            )}
            <div>
              <h1 className="font-display text-3xl font-semibold text-neutral-900 sm:text-4xl">
                Stories by {author.displayName}
              </h1>
              {author.tagline && <p className="mt-1 max-w-2xl text-sm text-neutral-600">{author.tagline}</p>}
              <p className="mt-1 text-sm text-neutral-500">
                {total} {total === 1 ? "post" : "posts"}
              </p>
            </div>
          </div>
          <Link
            href={publicSellerPath(author.id, author.displayName)}
            className="inline-flex w-fit items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm text-neutral-800 hover:bg-neutral-50"
          >
            Visit shop
          </Link>
        </div>
      </section>

      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
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
    </main>
  );
}
