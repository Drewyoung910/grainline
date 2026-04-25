// src/app/blog/[slug]/page.tsx
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import type { Metadata } from "next";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";
import NewsletterSignup from "@/components/NewsletterSignup";
import BlogCommentForm from "@/components/BlogCommentForm";
import BlogReplyToggle from "@/components/BlogReplyToggle";
import BlogCopyLinkButton from "@/components/BlogCopyLinkButton";
import SaveBlogButton from "@/components/SaveBlogButton";
import CoverLightbox from "@/components/CoverLightbox";
import { getBlockedUserIdsFor } from "@/lib/blocks";
import BlockReportButton from "@/components/BlockReportButton";
import { safeJsonLd } from "@/lib/json-ld";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await prisma.blogPost.findUnique({
    where: { slug },
    select: {
      title: true,
      metaDescription: true,
      excerpt: true,
      coverImageUrl: true,
      status: true,
      author: { select: { banned: true, deletedAt: true } },
    },
  });
  if (!post || post.status !== "PUBLISHED" || post.author.banned || post.author.deletedAt) return {};

  const description = post.metaDescription ?? post.excerpt ?? "";
  const ogImages = post.coverImageUrl
    ? [{ url: post.coverImageUrl }]
    : [{ url: "https://thegrainline.com/og-image.jpg" }];
  return {
    title: post.title,
    description,
    openGraph: {
      title: post.title,
      description,
      images: ogImages,
    },
    twitter: { card: "summary_large_image", title: post.title, description, images: ogImages.map((i) => i.url) },
    alternates: { canonical: `https://thegrainline.com/blog/${slug}` },
  };
}

function extractVideoId(url: string): { type: "youtube" | "vimeo"; id: string } | null {
  // Supports: youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, youtube.com/embed/, youtube.com/v/
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return { type: "youtube", id: yt[1] };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { type: "vimeo", id: vm[1] };
  return null;
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const post = await prisma.blogPost.findUnique({
    where: { slug },
    include: {
      author: { select: { id: true, name: true, imageUrl: true, banned: true, deletedAt: true, sellerProfile: { select: { avatarImageUrl: true, displayName: true } } } },
      sellerProfile: { select: { id: true, displayName: true, avatarImageUrl: true, user: { select: { imageUrl: true } } } },
      comments: {
        where: { approved: true, parentId: null, author: { banned: false, deletedAt: null } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, name: true, imageUrl: true, sellerProfile: { select: { avatarImageUrl: true } } } },
          replies: {
            where: { approved: true, author: { banned: false, deletedAt: null } },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              body: true,
              createdAt: true,
              author: { select: { id: true, name: true, imageUrl: true, sellerProfile: { select: { avatarImageUrl: true } } } },
              replies: {
                where: { approved: true, author: { banned: false, deletedAt: null } },
                orderBy: { createdAt: "asc" },
                select: {
                  id: true,
                  body: true,
                  createdAt: true,
                  author: { select: { id: true, name: true, imageUrl: true, sellerProfile: { select: { avatarImageUrl: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!post || post.status !== "PUBLISHED" || post.author.banned || post.author.deletedAt) return notFound();

  // Auth
  const { userId } = await auth();
  let meId: string | null = null;
  let isSaved = false;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meId = me?.id ?? null;
    if (meId) {
      const blockedUserIds = await getBlockedUserIdsFor(meId);
      if (blockedUserIds.has(post.author.id)) return notFound();
      const savedRow = await prisma.savedBlogPost.findUnique({
        where: { userId_blogPostId: { userId: meId, blogPostId: post.id } },
        select: { id: true },
      });
      isSaved = !!savedRow;
    }
  }

  // Render markdown body
  const rawHtml = marked.parse(post.body) as string;
  const htmlBody = sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'del', 'sup', 'sub', 'table', 'thead',
      'tbody', 'tr', 'th', 'td', 'pre', 'code',
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt', 'width', 'height'],
      a: ['href', 'target', 'rel'],
      code: ['class'],
      pre: ['class'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  });

  // Featured listings
  let featuredListings: Array<{
    id: string; title: string; priceCents: number; currency: string;
    photos: Array<{ url: string }>; seller: { displayName: string };
  }> = [];
  if (post.featuredListingIds.length > 0) {
    featuredListings = await prisma.listing.findMany({
      where: { id: { in: post.featuredListingIds }, status: "ACTIVE" },
      select: {
        id: true, title: true, priceCents: true, currency: true,
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { select: { displayName: true } },
      },
    });
    // Re-order by featuredListingIds order
    const byId = new Map(featuredListings.map((l) => [l.id, l]));
    featuredListings = post.featuredListingIds.map((id) => byId.get(id)).filter((l): l is typeof featuredListings[0] => !!l);
  }

  // Related posts
  const related = await prisma.blogPost.findMany({
    where: {
      status: "PUBLISHED",
      id: { not: post.id },
      OR: [
        { type: post.type },
        ...(post.tags.length > 0 ? [{ tags: { hasSome: post.tags } }] : []),
      ],
    },
    orderBy: { publishedAt: "desc" },
    take: 3,
    select: {
      slug: true, title: true, coverImageUrl: true, type: true,
      readingTimeMinutes: true, publishedAt: true,
      author: { select: { name: true, imageUrl: true } },
      sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
    },
  });

  const video = post.videoUrl ? extractVideoId(post.videoUrl) : null;
  const authorName = post.author.sellerProfile?.displayName ?? post.author.name ?? "Staff";
  const authorAvatar = post.author.sellerProfile?.avatarImageUrl ?? post.author.imageUrl ?? null;
  const postUrl = `https://thegrainline.com/blog/${slug}`;

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt ?? post.metaDescription ?? "",
    ...(post.coverImageUrl ? { image: post.coverImageUrl } : {}),
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: { "@type": "Person", name: authorName },
    publisher: {
      "@type": "Organization",
      name: "Grainline",
      url: "https://thegrainline.com",
      logo: { "@type": "ImageObject", url: "https://thegrainline.com/logo-espresso.svg" },
    },
  };

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      {/* JSON-LD: Article */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(articleLd) }}
      />
      {/* Breadcrumb */}
      <div className="mb-6 text-sm text-neutral-500">
        <Link href="/blog" className="hover:underline">Blog</Link>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{post.title}</span>
      </div>

      {/* Type badge + meta */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[post.type]}`}>
          {BLOG_TYPE_LABELS[post.type]}
        </span>
        {post.readingTimeMinutes && (
          <span className="text-xs text-neutral-500">{post.readingTimeMinutes} min read</span>
        )}
        {post.publishedAt && (
          <span className="text-xs text-neutral-500">
            {new Date(post.publishedAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
          </span>
        )}
      </div>

      {/* Title */}
      <div className="flex items-start gap-3 mb-6">
        <h1 className="text-3xl sm:text-4xl font-bold text-neutral-900 leading-tight flex-1">{post.title}</h1>
        <SaveBlogButton slug={slug} initialSaved={isSaved} />
      </div>

      {/* Author card */}
      <div className="flex items-center gap-3 mb-8 pb-6 border-b border-neutral-100">
        {authorAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={authorAvatar} alt={authorName} className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-neutral-200" />
        )}
        <div>
          <div className="font-medium text-sm">
            {post.authorType === "MAKER" && post.sellerProfile ? (
              <Link href={`/seller/${post.sellerProfile.id}`} className="hover:underline">
                {authorName}
              </Link>
            ) : (
              authorName
            )}
          </div>
          <div className="text-xs text-neutral-500">
            {post.authorType === "MAKER" ? "Maker" : "Grainline Staff"}
          </div>
        </div>
      </div>

      {/* Cover image */}
      {post.coverImageUrl && (
        <div className="mb-8 rounded-2xl overflow-hidden">
          <CoverLightbox
            src={post.coverImageUrl}
            alt={post.title}
            className="w-full h-64 sm:h-96 object-cover"
          />
        </div>
      )}

      {/* Video embed */}
      {video && (
        <div className="mb-8 rounded-2xl overflow-hidden aspect-video bg-black">
          {video.type === "youtube" ? (
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${video.id}`}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="Video"
            />
          ) : (
            <iframe
              src={`https://player.vimeo.com/video/${video.id}`}
              className="w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              title="Video"
            />
          )}
        </div>
      )}

      {/* Body (markdown) */}
      <article
        className="prose prose-neutral max-w-none mb-10 prose-headings:font-semibold prose-a:text-amber-700 prose-img:rounded-xl"
        dangerouslySetInnerHTML={{ __html: htmlBody }}
      />

      {/* Social share */}
      <div className="flex flex-wrap items-center gap-3 py-6 border-t border-b border-neutral-100 mb-8">
        <span className="text-sm font-medium text-neutral-700">Share:</span>
        <a
          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(postUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
        >
          𝕏 / Twitter
        </a>
        <a
          href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
        >
          Facebook
        </a>
        <BlogCopyLinkButton url={postUrl} />
      </div>

      {/* Featured listings */}
      {featuredListings.length > 0 && (
        <section className="mb-10">
          <h2 className="text-lg font-semibold mb-4">Featured in this post</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {featuredListings.map((l) => (
              <li key={l.id} className="card-listing">
                <Link href={`/listing/${l.id}`} className="block">
                  <div className="h-36 bg-neutral-100 overflow-hidden">
                    {l.photos[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.photos[0].url} alt={l.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-neutral-200" />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="font-medium text-sm line-clamp-1">{l.title}</div>
                    <div className="text-xs text-neutral-500">
                      {(l.priceCents / 100).toLocaleString(undefined, { style: "currency", currency: l.currency })}
                    </div>
                    <div className="text-xs text-neutral-400">{l.seller.displayName}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Newsletter */}
      <div className="mb-10">
        <NewsletterSignup />
      </div>

      {/* Comments */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-1">
          {post.comments.length} comment{post.comments.length !== 1 ? "s" : ""}
        </h2>
        <p className="text-xs text-neutral-500 mb-5">Comments are moderated before appearing.</p>

        {post.comments.length > 0 && (
          <ul className="space-y-4 mb-6">
            {post.comments.map((c) => {
              const cAvatarUrl = c.author.sellerProfile?.avatarImageUrl ?? c.author.imageUrl;
              return (
              <li key={c.id} className="flex flex-col gap-0">
                <div className="flex gap-3">
                  {cAvatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cAvatarUrl} alt={c.author.name ?? ""} className="h-8 w-8 rounded-full object-cover shrink-0 mt-0.5" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-neutral-200 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.author.name ?? "User"}</span>
                      <span className="text-xs text-neutral-400">
                        {new Date(c.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                      {meId && meId !== c.author.id && (
                        <span className="ml-auto">
                          <BlockReportButton
                            targetUserId={c.author.id}
                            targetName={c.author.name ?? "this user"}
                            targetType="BLOG_COMMENT"
                            targetId={c.id}
                          />
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-neutral-700 mt-0.5 whitespace-pre-wrap">{c.body}</p>
                  </div>
                </div>
                <BlogReplyToggle
                  slug={slug}
                  parentId={c.id}
                  replies={c.replies}
                  isSignedIn={!!meId}
                  meId={meId}
                />
              </li>
              );
            })}
          </ul>
        )}

        {meId ? (
          <BlogCommentForm slug={slug} />
        ) : (
          <p className="text-sm text-neutral-600">
            <Link href={`/sign-in?redirect_url=/blog/${slug}`} className="underline">Sign in</Link> to leave a comment.
          </p>
        )}
      </section>

      {/* Related posts */}
      {related.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-4">More from the Workshop</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {related.map((r) => {
              const rName = r.sellerProfile?.displayName ?? r.author.name ?? "Staff";
              const rAvatar = r.sellerProfile?.avatarImageUrl ?? r.author.imageUrl;
              return (
                <li key={r.slug} className="card-listing">
                  <Link href={`/blog/${r.slug}`} className="block">
                    <div className="h-32 bg-neutral-100 overflow-hidden">
                      {r.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.coverImageUrl} alt={r.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                      )}
                    </div>
                    <div className="p-3 space-y-1">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[r.type]}`}>
                        {BLOG_TYPE_LABELS[r.type]}
                      </span>
                      <div className="font-medium text-sm line-clamp-2 mt-1">{r.title}</div>
                      <div className="flex items-center gap-1.5">
                        {rAvatar ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={rAvatar} alt={rName} className="h-4 w-4 rounded-full object-cover" />
                        ) : (
                          <div className="h-4 w-4 rounded-full bg-neutral-200" />
                        )}
                        <span className="text-xs text-neutral-400">{rName}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
