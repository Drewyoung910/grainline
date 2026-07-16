// src/app/dashboard/blog/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";
import ConfirmButton from "@/components/ConfirmButton";
import ToastOnMount from "@/components/ToastOnMount";
import { blogCreateRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { revalidateBlogSearchCaches } from "@/lib/searchCache";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { BlogManagerSkeleton } from "@/components/SellerRouteSkeletons";
import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };
const PAGE_SIZE = 20;

async function archivePost(postId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { success } = await safeRateLimit(blogCreateRatelimit, userId);
  if (!success) return;
  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) redirect("/sign-in");
  if (me.banned || me.deletedAt) return;

  const post = await prisma.blogPost.findUnique({ where: { id: postId }, select: { authorId: true, status: true } });
  if (!post || post.authorId !== me.id) return;
  if (post.status === "ARCHIVED") redirect("/dashboard/blog");

  await prisma.blogPost.updateMany({
    where: { id: postId, authorId: me.id, status: { not: "ARCHIVED" } },
    data: { status: "ARCHIVED" },
  });
  revalidatePath("/dashboard/blog");
  revalidateBlogSearchCaches();
  redirect("/dashboard/blog?postAction=archived");
}

async function unarchivePost(postId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const { success } = await safeRateLimit(blogCreateRatelimit, userId);
  if (!success) return;
  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) redirect("/sign-in");
  if (me.banned || me.deletedAt) return;

  const post = await prisma.blogPost.findUnique({
    where: { id: postId },
    select: { authorId: true, status: true, publishedAt: true },
  });
  if (!post || post.authorId !== me.id) return;
  if (post.status !== "ARCHIVED") redirect("/dashboard/blog");

  await prisma.blogPost.updateMany({
    where: { id: postId, authorId: me.id, status: "ARCHIVED" },
    data: { status: post.publishedAt ? "PUBLISHED" : "DRAFT" },
  });
  revalidatePath("/dashboard/blog");
  revalidateBlogSearchCaches();
  redirect("/dashboard/blog?postAction=unarchived");
}

export default function DashboardBlogPage({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; postAction?: string }>;
}) {
  return (
    <Suspense fallback={<BlogManagerSkeleton />}>
      <DashboardBlogContent searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardBlogContent({
  searchParams,
}: {
  searchParams?: Promise<{ page?: string; postAction?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/blog");
  const params = searchParams ? await searchParams : {};

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true },
  });
  if (!me) redirect("/sign-in");

  const requestedPage = parseBoundedPositiveIntParam(params.page, 1, 1000);
  const totalPosts = await prisma.blogPost.count({ where: { authorId: me.id } });
  const totalPages = Math.max(1, Math.ceil(totalPosts / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const posts = await prisma.blogPost.findMany({
    where: { authorId: me.id },
    orderBy: { updatedAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: {
      id: true, slug: true, title: true, type: true, status: true,
      publishedAt: true, readingTimeMinutes: true,
    },
  });

  const STATUS_COLORS: Record<string, string> = {
    DRAFT: "bg-neutral-100 text-neutral-600",
    PUBLISHED: "bg-green-100 text-green-800",
    ARCHIVED: "bg-stone-100 text-stone-600",
  };

  return (
    <main className="max-w-7xl mx-auto p-8">
      {params.postAction === "archived" && (
        <ToastOnMount message="Post archived." type="success" clearParam="postAction" />
      )}
      {params.postAction === "unarchived" && (
        <ToastOnMount message="Post unarchived." type="success" clearParam="postAction" />
      )}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl font-semibold">My Blog Posts</h1>
          <p className="text-neutral-500 text-sm mt-0.5">
            {me.role === "EMPLOYEE" || me.role === "ADMIN" ? "Staff posts" : "Your maker posts"}
          </p>
        </div>
        <Link
          href="/dashboard/blog/new"
          className="inline-flex min-h-[40px] items-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + New Post
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="card-section p-10 text-center text-neutral-500">
          No posts yet.{" "}
          <Link href="/dashboard/blog/new" className="underline text-neutral-700">
            Write your first post
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-100 card-section">
          {posts.map((p) => (
            <li key={p.id} className="flex items-center gap-4 px-4 py-3 bg-white hover:bg-neutral-50">
              <Link
                href={p.status === "PUBLISHED" ? `/blog/${p.slug}` : `/dashboard/blog/${p.id}/edit`}
                className="flex-1 min-w-0 rounded-md focus:outline-none focus:ring-2 focus:ring-neutral-300"
              >
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[p.type]}`}>
                    {BLOG_TYPE_LABELS[p.type]}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[p.status] ?? "bg-neutral-100 text-neutral-600"}`}>
                    {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                  </span>
                </div>
                <div className="font-medium truncate">{p.title}</div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {p.publishedAt
                    ? `Published ${new Date(p.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                    : "Not published"}
                  {p.readingTimeMinutes ? ` · ${p.readingTimeMinutes} min read` : ""}
                </div>
              </Link>
              <div className="flex items-center gap-2 shrink-0">
                {p.status === "PUBLISHED" && (
                  <Link
                    href={`/blog/${p.slug}`}
                    className="inline-flex min-h-[30px] items-center justify-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View
                  </Link>
                )}
                <Link
                  href={`/dashboard/blog/${p.id}/edit`}
                  className="inline-flex min-h-[30px] items-center justify-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Edit
                </Link>
                {p.status === "ARCHIVED" ? (
                  <form action={unarchivePost.bind(null, p.id)}>
                    <ConfirmButton
                      confirm="Unarchive this post?"
                      className="inline-flex min-h-[30px] items-center justify-center rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                    >
                      Unarchive
                    </ConfirmButton>
                  </form>
                ) : (
                  <form action={archivePost.bind(null, p.id)}>
                    <ConfirmButton
                      confirm="Archive this post?"
                      className="inline-flex min-h-[30px] items-center justify-center rounded-md border border-amber-200 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                    >
                      Archive
                    </ConfirmButton>
                  </form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-4">
          {page > 1 && (
            <Link
              href={`/dashboard/blog?page=${page - 1}`}
              className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-neutral-600">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/dashboard/blog?page=${page + 1}`}
              className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Next
            </Link>
          )}
        </div>
      )}
    </main>
  );
}
