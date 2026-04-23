// src/app/dashboard/blog/new/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { generateSlug, calculateReadingTime } from "@/lib/blog";
import { BlogPostType, BlogAuthorType } from "@prisma/client";
import BlogPostForm from "@/components/BlogPostForm";
import { createNotification } from "@/lib/notifications";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function NewBlogPostPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/blog/new");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true },
  });
  if (!me) redirect("/sign-in");

  const isStaff = me.role === "EMPLOYEE" || me.role === "ADMIN";

  // For makers: fetch their seller profile + listings for featured listing checkboxes
  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true, listings: { where: { status: "ACTIVE" }, select: { id: true, title: true }, orderBy: { updatedAt: "desc" } } },
  });

  async function createBlogPost(formData: FormData) {
    "use server";
    const { userId: uid } = await auth();
    if (!uid) redirect("/sign-in");
    const author = await prisma.user.findUnique({ where: { clerkId: uid }, select: { id: true, role: true } });
    if (!author) redirect("/sign-in");

    const isStaffUser = author.role === "EMPLOYEE" || author.role === "ADMIN";

    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const excerpt = String(formData.get("excerpt") ?? "").trim().slice(0, 200) || null;
    const metaDescription = String(formData.get("metaDescription") ?? "").trim().slice(0, 160) || null;
    const coverImageUrl = String(formData.get("coverImageUrl") ?? "").trim() || null;
    const videoUrl = String(formData.get("videoUrl") ?? "").trim() || null;
    const type = (formData.get("type") as BlogPostType) ?? "STANDARD";
    const status = (formData.get("status") as "DRAFT" | "PUBLISHED") ?? "DRAFT";
    const tagsRaw = String(formData.get("tags") ?? "").trim();
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [];
    const featuredListingIds = formData.getAll("featuredListingIds").map(String).filter(Boolean);

    if (!title || !body) return;

    // Profanity check (log-only)
    const { containsProfanity } = await import("@/lib/profanity");
    const profCheck = containsProfanity(`${title} ${excerpt ?? ""} ${body}`);
    if (profCheck.flagged) {
      console.error(`[PROFANITY] Blog post by ${uid}: ${profCheck.matches.join(", ")}`);
    }

    // Validate type
    const allowedTypes: BlogPostType[] = isStaffUser
      ? Object.values(BlogPostType)
      : ["STANDARD", "BEHIND_THE_BUILD"];
    if (!allowedTypes.includes(type)) return;

    // Generate unique slug
    let baseSlug = generateSlug(title);
    if (!baseSlug) baseSlug = "post";
    let slug = baseSlug;
    let attempt = 2;
    while (await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } })) {
      slug = `${baseSlug}-${attempt++}`;
    }

    const readingTimeMinutes = calculateReadingTime(body);
    const authorType: BlogAuthorType = isStaffUser ? "STAFF" : "MAKER";
    const sellerProfileId = !isStaffUser
      ? (await prisma.sellerProfile.findUnique({ where: { userId: author.id }, select: { id: true } }))?.id ?? null
      : null;

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
        featuredListingIds,
        readingTimeMinutes,
        authorType,
        authorId: author.id,
        sellerProfileId,
        publishedAt: status === "PUBLISHED" ? new Date() : null,
      },
    });

    // Notify followers of makers when a new post is published
    if (status === "PUBLISHED" && sellerProfileId) {
      void (async () => {
        try {
          const followers = await prisma.follow.findMany({
            where: { sellerProfileId },
            select: { followerId: true },
          });
          const sellerProfile = await prisma.sellerProfile.findUnique({
            where: { id: sellerProfileId },
            select: { displayName: true },
          });
          const sellerDisplay = sellerProfile?.displayName ?? "A maker you follow";
          await Promise.all(
            followers.map((f) =>
              createNotification({
                userId: f.followerId,
                type: "FOLLOWED_MAKER_NEW_BLOG",
                title: `New post from ${sellerDisplay}`,
                body: newPost.title,
                link: `/blog/${newPost.slug}`,
              })
            )
          );
        } catch { /* non-fatal */ }
      })();
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
