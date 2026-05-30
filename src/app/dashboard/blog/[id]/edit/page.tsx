// src/app/dashboard/blog/[id]/edit/page.tsx
import { redirect, notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { BLOG_BODY_MAX_CHARS, calculateReadingTime } from "@/lib/blog";
import { BlogPostType } from "@prisma/client";
import BlogPostForm from "@/components/BlogPostForm";
import { createNotification } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { normalizeBlogCoverImageUrl, normalizeBlogVideoUrl } from "@/lib/blogInput";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { normalizeTags } from "@/lib/tags";
import { revalidateBlogSearchCaches } from "@/lib/searchCache";
import { captureProfanityFlag } from "@/lib/profanityTelemetry";
import { parseUpdateBlogStatus } from "@/lib/blogStatusInput";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function EditBlogPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!me) redirect("/sign-in");
  if (me.banned || me.deletedAt) redirect("/dashboard");

  const post = await prisma.blogPost.findUnique({
    where: { id },
    select: {
      id: true, slug: true, title: true, body: true, excerpt: true,
      metaDescription: true, coverImageUrl: true, videoUrl: true,
      type: true, status: true, tags: true, featuredListingIds: true,
      authorId: true,
    },
  });
  if (!post || post.authorId !== me.id) return notFound();

  const isStaff = me.role === "EMPLOYEE" || me.role === "ADMIN";

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true, listings: { where: { status: "ACTIVE" }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" } } },
  });

  async function updateBlogPost(_prevState: unknown, formData: FormData) {
    "use server";
    const { userId: uid } = await auth();
    if (!uid) redirect("/sign-in");
    const author = await prisma.user.findUnique({
      where: { clerkId: uid },
      select: { id: true, role: true, banned: true, deletedAt: true },
    });
    if (!author) redirect("/sign-in");
    if (author.banned || author.deletedAt) return { ok: false, error: "Account is suspended." };

    const existing = await prisma.blogPost.findUnique({
      where: { id },
      select: {
        authorId: true,
        status: true,
        publishedAt: true,
        slug: true,
        sellerProfileId: true,
        coverImageUrl: true,
        updatedAt: true,
      },
    });
    if (!existing || existing.authorId !== author.id) return { ok: false, error: "Post not found." };

    const isStaffUser = author.role === "EMPLOYEE" || author.role === "ADMIN";

    const title = truncateText(sanitizeText(String(formData.get("title") ?? "").trim()), 200);
    const body = truncateText(sanitizeText(String(formData.get("body") ?? "").trim()), BLOG_BODY_MAX_CHARS);
    const excerpt = truncateText(sanitizeText(String(formData.get("excerpt") ?? "").trim()), 200) || null;
    const metaDescription = truncateText(sanitizeText(String(formData.get("metaDescription") ?? "").trim()), 160) || null;
    let coverImageUrl: string | null = null;
    let videoUrl: string | null = null;
    try {
      coverImageUrl = normalizeBlogCoverImageUrl(formData.get("coverImageUrl"), uid, existing.coverImageUrl);
      videoUrl = normalizeBlogVideoUrl(formData.get("videoUrl"));
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "One of the media URLs is invalid.",
      };
    }
    const type = (formData.get("type") as BlogPostType) ?? "STANDARD";
    const newStatus = parseUpdateBlogStatus(formData.get("status"));
    if (!newStatus) return { ok: false, error: "That blog status is not available." };
    const tagsRaw = String(formData.get("tags") ?? "").trim();
    const tags = tagsRaw ? normalizeTags(tagsRaw.split(",")) : [];
    const featuredListingIds = formData.getAll("featuredListingIds").map(String).filter(Boolean);

    if (!title || !body) return { ok: false, error: "Title and body are required." };

    const { containsProfanity } = await import("@/lib/profanity");
    const profCheck = containsProfanity(`${title} ${excerpt ?? ""} ${body} ${tags.join(" ")}`);
    if (profCheck.flagged) {
      captureProfanityFlag({
        source: "blog_update",
        matchCount: profCheck.matches.length,
        extra: { clerkUserId: uid, postId: id, status: newStatus },
      });
      if (newStatus === "PUBLISHED") {
        return { ok: false, error: "This post needs edits before it can be published." };
      }
    }

    const allowedTypes: BlogPostType[] = isStaffUser
      ? Object.values(BlogPostType)
      : ["STANDARD", "BEHIND_THE_BUILD"];
    if (!allowedTypes.includes(type)) return { ok: false, error: "That blog post type is not available for this account." };

    const readingTimeMinutes = calculateReadingTime(body);
    const uniqueFeaturedListingIds = [...new Set(featuredListingIds)].slice(0, 6);
    const verifiedFeaturedListings = uniqueFeaturedListingIds.length
      ? await prisma.listing.findMany({
          where: {
            id: { in: uniqueFeaturedListingIds },
            status: "ACTIVE",
            ...(isStaffUser ? {} : { sellerId: existing.sellerProfileId ?? "__none" }),
          },
          select: { id: true },
        })
      : [];
    const verifiedFeaturedListingIds = uniqueFeaturedListingIds.filter((featuredId) =>
      verifiedFeaturedListings.some((listing) => listing.id === featuredId)
    );

    // `publishedAt` is the first-publication timestamp. Keep it when a post is
    // archived/drafted so re-publishing cannot look like a brand-new post.
    const transitioningToPublished = newStatus === "PUBLISHED" && existing.status !== "PUBLISHED";
    const isFirstPublish = transitioningToPublished && existing.publishedAt === null;
    let publishedAt: Date | null | undefined = undefined;
    if (transitioningToPublished) {
      const { safeRateLimit, blogCreateRatelimit } = await import("@/lib/ratelimit");
      const { success: rlOk } = await safeRateLimit(blogCreateRatelimit, author.id);
      if (!rlOk) return { ok: false, error: "You can publish up to 3 blog posts per day." };
      if (isFirstPublish) {
        publishedAt = new Date();
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const claimed = await tx.blogPost.updateMany({
        where: {
          id,
          authorId: author.id,
          status: existing.status,
          updatedAt: existing.updatedAt,
        },
        data: {
          title,
          body,
          excerpt,
          metaDescription,
          coverImageUrl,
          videoUrl,
          type,
          status: newStatus,
          tags,
          featuredListingIds: verifiedFeaturedListingIds,
          readingTimeMinutes,
          ...(publishedAt !== undefined ? { publishedAt } : {}),
        },
      });
      if (claimed.count === 0) return null;
      return tx.blogPost.findUnique({
        where: { id },
        select: { slug: true, sellerProfileId: true, sellerProfile: { select: { displayName: true, userId: true } } },
      });
    });
    if (!updated) return { ok: false, error: "Post changed while saving. Refresh and try again." };

    if (existing.status === "PUBLISHED" || newStatus === "PUBLISHED") {
      revalidateBlogSearchCaches();
    }

    // Notify followers only on the first-ever publish, not on archive/republish.
    if (isFirstPublish && updated.sellerProfileId && updated.sellerProfile?.userId) {
      after(async () => {
        try {
          const sellerUserId = updated.sellerProfile!.userId;
          const followers = await prisma.follow.findMany({
            where: {
              sellerProfileId: updated.sellerProfileId!,
              followerId: { not: sellerUserId },
              follower: {
                banned: false,
                deletedAt: null,
                blocks: { none: { blockedId: sellerUserId } },
                blockedBy: { none: { blockerId: sellerUserId } },
              },
            },
            select: { followerId: true },
            take: 10000,
          });
          if (followers.length > 0) {
            const sellerName = updated.sellerProfile?.displayName ?? "A maker you follow";
            await mapWithConcurrency(followers, 10, (f) =>
              createNotification({
                userId: f.followerId,
                type: "FOLLOWED_MAKER_NEW_BLOG",
                title: `New post from ${sellerName}`,
                body: title,
                link: `/blog/${updated.slug}`,
              }),
            );
          }
        } catch (error) {
          Sentry.captureException(error, {
            level: "warning",
            tags: { source: "blog_update_follower_notification" },
            extra: { postId: id, sellerProfileId: updated.sellerProfileId },
          });
        }
      });
    }

    redirect("/dashboard/blog");
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">Edit Post</h1>
      <BlogPostForm
        action={updateBlogPost}
        isStaff={isStaff}
        listings={seller?.listings ?? []}
        submitLabel="Save changes"
        defaultValues={{
          title: post.title,
          type: post.type,
          coverImageUrl: post.coverImageUrl ?? "",
          videoUrl: post.videoUrl ?? "",
          body: post.body,
          excerpt: post.excerpt ?? "",
          metaDescription: post.metaDescription ?? "",
          tags: post.tags.join(", "),
          featuredListingIds: post.featuredListingIds,
          status: post.status,
        }}
      />
    </main>
  );
}
