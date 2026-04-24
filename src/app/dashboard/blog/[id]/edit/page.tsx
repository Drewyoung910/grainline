// src/app/dashboard/blog/[id]/edit/page.tsx
import { redirect, notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { calculateReadingTime } from "@/lib/blog";
import { BlogPostType } from "@prisma/client";
import BlogPostForm from "@/components/BlogPostForm";
import { createNotification } from "@/lib/notifications";
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
    select: { id: true, role: true },
  });
  if (!me) redirect("/sign-in");

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

  async function updateBlogPost(formData: FormData) {
    "use server";
    const { userId: uid } = await auth();
    if (!uid) redirect("/sign-in");
    const author = await prisma.user.findUnique({ where: { clerkId: uid }, select: { id: true, role: true } });
    if (!author) redirect("/sign-in");

    const existing = await prisma.blogPost.findUnique({ where: { id }, select: { authorId: true, status: true, publishedAt: true, slug: true } });
    if (!existing || existing.authorId !== author.id) return;

    const isStaffUser = author.role === "EMPLOYEE" || author.role === "ADMIN";

    const title = String(formData.get("title") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();
    const excerpt = String(formData.get("excerpt") ?? "").trim().slice(0, 200) || null;
    const metaDescription = String(formData.get("metaDescription") ?? "").trim().slice(0, 160) || null;
    const coverImageUrl = String(formData.get("coverImageUrl") ?? "").trim() || null;
    const videoUrl = String(formData.get("videoUrl") ?? "").trim() || null;
    const type = (formData.get("type") as BlogPostType) ?? "STANDARD";
    const newStatus = (formData.get("status") as "DRAFT" | "PUBLISHED" | "ARCHIVED") ?? "DRAFT";
    const tagsRaw = String(formData.get("tags") ?? "").trim();
    const tags = tagsRaw ? tagsRaw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [];
    const featuredListingIds = formData.getAll("featuredListingIds").map(String).filter(Boolean);

    if (!title || !body) return;

    const allowedTypes: BlogPostType[] = isStaffUser
      ? Object.values(BlogPostType)
      : ["STANDARD", "BEHIND_THE_BUILD"];
    if (!allowedTypes.includes(type)) return;

    const readingTimeMinutes = calculateReadingTime(body);

    // Set publishedAt if transitioning to PUBLISHED
    let publishedAt: Date | null | undefined = undefined;
    if (newStatus === "PUBLISHED" && existing.status !== "PUBLISHED") {
      publishedAt = new Date();
    } else if (newStatus !== "PUBLISHED") {
      publishedAt = null;
    }

    const updated = await prisma.blogPost.update({
      where: { id },
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
        featuredListingIds,
        readingTimeMinutes,
        ...(publishedAt !== undefined ? { publishedAt } : {}),
      },
      select: { slug: true, sellerProfileId: true, sellerProfile: { select: { displayName: true } } },
    });

    // Notify followers when a maker blog post is first published
    if (newStatus === "PUBLISHED" && existing.status !== "PUBLISHED" && updated.sellerProfileId) {
      after(async () => {
        try {
          const followers = await prisma.follow.findMany({
            where: { sellerProfileId: updated.sellerProfileId! },
            select: { followerId: true },
          });
          if (followers.length > 0) {
            const sellerName = updated.sellerProfile?.displayName ?? "A maker you follow";
            await Promise.all(
              followers.map((f) =>
                createNotification({
                  userId: f.followerId,
                  type: "FOLLOWED_MAKER_NEW_BLOG",
                  title: `New post from ${sellerName}`,
                  body: title,
                  link: `/blog/${updated.slug}`,
                })
              )
            );
          }
        } catch { /* non-fatal */ }
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
