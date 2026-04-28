// src/app/dashboard/blog/new/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { generateSlug, calculateReadingTime } from "@/lib/blog";
import { BlogPostType, BlogAuthorType } from "@prisma/client";
import BlogPostForm from "@/components/BlogPostForm";
import { createNotification } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { normalizeBlogCoverImageUrl, normalizeBlogVideoUrl } from "@/lib/blogInput";
import { sanitizeText } from "@/lib/sanitize";
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

    const title = sanitizeText(String(formData.get("title") ?? "").trim()).slice(0, 200);
    const body = String(formData.get("body") ?? "").trim();
    const excerpt = String(formData.get("excerpt") ?? "").trim().slice(0, 200) || null;
    const metaDescription = String(formData.get("metaDescription") ?? "").trim().slice(0, 160) || null;
    let coverImageUrl: string | null = null;
    let videoUrl: string | null = null;
    try {
      coverImageUrl = normalizeBlogCoverImageUrl(formData.get("coverImageUrl"));
      videoUrl = normalizeBlogVideoUrl(formData.get("videoUrl"));
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "One of the media URLs is invalid.",
      };
    }
    const type = (formData.get("type") as BlogPostType) ?? "STANDARD";
    const status = (formData.get("status") as "DRAFT" | "PUBLISHED") ?? "DRAFT";
    const tagsRaw = String(formData.get("tags") ?? "").trim();
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [];
    const featuredListingIds = formData.getAll("featuredListingIds").map(String).filter(Boolean);

    if (!title || !body) return { ok: false, error: "Title and body are required." };

    // Profanity check. Drafts may be saved for editing, but public posts fail closed.
    const { containsProfanity } = await import("@/lib/profanity");
    const profCheck = containsProfanity(`${title} ${excerpt ?? ""} ${body}`);
    if (profCheck.flagged) {
      console.error(`[PROFANITY] Blog post by ${uid}: ${profCheck.matches.join(", ")}`);
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
    const sellerProfileId = !isStaffUser
      ? (await prisma.sellerProfile.findUnique({ where: { userId: author.id }, select: { id: true } }))?.id ?? null
      : null;
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

    const newPost = await prisma.blogPost.create({
      data: {
        slug,
        title,
        body,
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

    // Notify followers of makers when a new post is published
    if (status === "PUBLISHED" && sellerProfileId) {
      after(async () => {
        try {
          const followers = await prisma.follow.findMany({
            where: {
              sellerProfileId,
              follower: { banned: false, deletedAt: null },
            },
            select: { followerId: true },
            take: 10000,
          });
          const sellerProfile = await prisma.sellerProfile.findUnique({
            where: { id: sellerProfileId },
            select: { displayName: true },
          });
          const sellerDisplay = sellerProfile?.displayName ?? "A maker you follow";
          await mapWithConcurrency(followers, 10, (f) =>
            createNotification({
              userId: f.followerId,
              type: "FOLLOWED_MAKER_NEW_BLOG",
              title: `New post from ${sellerDisplay}`,
              body: newPost.title,
              link: `/blog/${newPost.slug}`,
            }),
          );
        } catch { /* non-fatal */ }
      });
    }

    redirect("/dashboard/blog");
  }

  return (
    <main className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">New Blog Post</h1>
      <BlogPostForm
        action={createBlogPost}
        isStaff={isStaff}
        listings={seller?.listings ?? []}
        submitLabel="Create Post"
      />
    </main>
  );
}
