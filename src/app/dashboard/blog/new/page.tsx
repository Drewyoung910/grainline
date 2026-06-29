// src/app/dashboard/blog/new/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { BLOG_BODY_MAX_CHARS, generateSlug, calculateReadingTime } from "@/lib/blog";
import { BlogPostType, BlogAuthorType, Prisma } from "@prisma/client";
import BlogPostForm from "@/components/BlogPostForm";
import { normalizeBlogCoverImageUrl, normalizeBlogVideoUrl } from "@/lib/blogInput";
import { claimDirectUploadsForUrls } from "@/lib/directUploadLifecycle";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { normalizeTags } from "@/lib/tags";
import { revalidateBlogSearchCaches } from "@/lib/searchCache";
import { captureProfanityFlag } from "@/lib/profanityTelemetry";
import { parseCreateBlogStatus } from "@/lib/blogStatusInput";
import { fanOutBlogPostToFollowers } from "@/lib/followerBlogNotifications";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewBlogPostPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/blog/new");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
  if (!me) redirect("/sign-in");
  if (me.banned || me.deletedAt) redirect("/dashboard");

  const isStaff = me.role === "EMPLOYEE" || me.role === "ADMIN";

  // For makers: fetch their seller profile + listings for featured listing checkboxes
  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true, listings: { where: { status: "ACTIVE" }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" } } },
  });
  if (!isStaff && !seller) redirect("/dashboard");

  async function createBlogPost(_prevState: unknown, formData: FormData) {
    "use server";
    const { userId: uid } = await auth();
    if (!uid) redirect("/sign-in");
    const author = await prisma.user.findUnique({
      where: { clerkId: uid },
      select: { id: true, role: true, banned: true, deletedAt: true },
    });
    if (!author) redirect("/sign-in");
    if (author.banned || author.deletedAt) return { ok: false, error: "Account is suspended." };

    const isStaffUser = author.role === "EMPLOYEE" || author.role === "ADMIN";

    // Rate limit: 3 blog posts per day
    const { safeRateLimit, blogCreateRatelimit } = await import("@/lib/ratelimit");
    const { success: rlOk } = await safeRateLimit(blogCreateRatelimit, author.id);
    if (!rlOk) return { ok: false, error: "You can publish up to 3 blog posts per day." };

    const title = truncateText(sanitizeText(String(formData.get("title") ?? "").trim()), 200);
    const body = truncateText(sanitizeText(String(formData.get("body") ?? "").trim()), BLOG_BODY_MAX_CHARS);
    const materialDisclosure =
      truncateText(sanitizeText(String(formData.get("materialDisclosure") ?? "").trim()), 500) || null;
    const excerpt = truncateText(sanitizeText(String(formData.get("excerpt") ?? "").trim()), 200) || null;
    const metaDescription = truncateText(sanitizeText(String(formData.get("metaDescription") ?? "").trim()), 160) || null;
    let coverImageUrl: string | null = null;
    let videoUrl: string | null = null;
    try {
      coverImageUrl = await normalizeBlogCoverImageUrl(formData.get("coverImageUrl"), uid, undefined, author.id);
      videoUrl = normalizeBlogVideoUrl(formData.get("videoUrl"));
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "One of the media URLs is invalid.",
      };
    }
    const type = (formData.get("type") as BlogPostType) ?? "STANDARD";
    const status = parseCreateBlogStatus(formData.get("status"));
    if (!status) return { ok: false, error: "That blog status is not available." };
    const tagsRaw = String(formData.get("tags") ?? "").trim();
    const tags = tagsRaw ? normalizeTags(tagsRaw.split(",")) : [];
    const featuredListingIds = formData.getAll("featuredListingIds").map(String).filter(Boolean);

    if (!title || !body) return { ok: false, error: "Title and body are required." };

    // Profanity check. Drafts may be saved for editing, but public posts fail closed.
    const { containsProfanity } = await import("@/lib/profanity");
    const profCheck = containsProfanity(`${title} ${excerpt ?? ""} ${materialDisclosure ?? ""} ${body} ${tags.join(" ")}`);
    if (profCheck.flagged) {
      captureProfanityFlag({
        source: "blog_create",
        matchCount: profCheck.matches.length,
        extra: { clerkUserId: uid, status },
      });
      if (status === "PUBLISHED") {
        return { ok: false, error: "This post needs edits before it can be published." };
      }
    }

    // Validate type
    const allowedTypes: BlogPostType[] = isStaffUser
      ? Object.values(BlogPostType)
      : ["STANDARD", "BEHIND_THE_BUILD"];
    if (!allowedTypes.includes(type)) return { ok: false, error: "That blog post type is not available for this account." };

    // Generate unique slug
    let baseSlug = generateSlug(title);
    if (!baseSlug) baseSlug = "post";
    let slug = baseSlug;
    let attempt = 2;
    while (await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } })) {
      if (attempt > 100) return { ok: false, error: "Could not generate a unique blog slug." };
      slug = `${baseSlug}-${attempt++}`;
    }

    const readingTimeMinutes = calculateReadingTime(body);
    const authorType: BlogAuthorType = isStaffUser ? "STAFF" : "MAKER";
    const sellerForAuthor = !isStaffUser
      ? await prisma.sellerProfile.findUnique({ where: { userId: author.id }, select: { id: true } })
      : null;
    if (!isStaffUser && !sellerForAuthor) {
      return { ok: false, error: "Create a maker profile before publishing blog posts." };
    }
    const sellerProfileId = sellerForAuthor?.id ?? null;
    const uniqueFeaturedListingIds = [...new Set(featuredListingIds)].slice(0, 6);
    const verifiedFeaturedListings = uniqueFeaturedListingIds.length
      ? await prisma.listing.findMany({
          where: {
            id: { in: uniqueFeaturedListingIds },
            status: "ACTIVE",
            ...(isStaffUser ? {} : { sellerId: sellerProfileId ?? "__none" }),
          },
          select: { id: true },
        })
      : [];
    const verifiedFeaturedListingIds = uniqueFeaturedListingIds.filter((id) =>
      verifiedFeaturedListings.some((listing) => listing.id === id)
    );

    let newPost;
    for (let createAttempt = 0; createAttempt < 5; createAttempt += 1) {
      try {
        newPost = await prisma.$transaction(async (tx) => {
          const created = await tx.blogPost.create({
            data: {
              slug,
              title,
              body,
              materialDisclosure,
              excerpt,
              metaDescription,
              coverImageUrl,
              videoUrl,
              type,
              status,
              tags,
              featuredListingIds: verifiedFeaturedListingIds,
              readingTimeMinutes,
              authorType,
              authorId: author.id,
              sellerProfileId,
              publishedAt: status === "PUBLISHED" ? new Date() : null,
            },
          });
          if (coverImageUrl) {
            await claimDirectUploadsForUrls({
              client: tx,
              urls: [coverImageUrl],
              userId: author.id,
              claimedByType: "BlogPost",
              claimedById: created.id,
            });
          }
          return created;
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002" &&
          Array.isArray(error.meta?.target) &&
          error.meta.target.includes("slug")
        ) {
          if (attempt > 100) return { ok: false, error: "Could not generate a unique blog slug." };
          slug = `${baseSlug}-${attempt++}`;
          continue;
        }
        throw error;
      }
    }
    if (!newPost) return { ok: false, error: "Could not generate a unique blog slug." };

    if (status === "PUBLISHED") {
      revalidateBlogSearchCaches();
    }

    // Notify followers of makers when a new post is published
    if (status === "PUBLISHED" && sellerProfileId) {
      after(async () => {
        try {
          await fanOutBlogPostToFollowers({ postId: newPost.id, sellerProfileId });
        } catch (error) {
          Sentry.captureException(error, {
            level: "warning",
            tags: { source: "blog_create_follower_notification" },
            extra: { postId: newPost.id, sellerProfileId },
          });
        }
      });
    }

    redirect("/dashboard/blog");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold font-display">New Blog Post</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Share build notes, project stories, and educational posts with buyers.
        </p>
      </div>
      <section className="card-section p-6">
        <BlogPostForm
          action={createBlogPost}
          isStaff={isStaff}
          listings={seller?.listings ?? []}
          submitLabel="Create Post"
        />
      </section>
    </main>
  );
}
