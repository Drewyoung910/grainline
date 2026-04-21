// src/app/dashboard/blog/page.tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";
import ConfirmButton from "@/components/ConfirmButton";

async function deletePost(postId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) redirect("/sign-in");

  const post = await prisma.blogPost.findUnique({ where: { id: postId }, select: { authorId: true } });
  if (!post || post.authorId !== me.id) return;

  await prisma.blogPost.delete({ where: { id: postId } });
  revalidatePath("/dashboard/blog");
}

export default async function DashboardBlogPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/blog");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true },
  });
  if (!me) redirect("/sign-in");

  const posts = await prisma.blogPost.findMany({
    where: { authorId: me.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
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
    <main className="max-w-4xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Blog Posts</h1>
          <p className="text-neutral-500 text-sm mt-0.5">
            {me.role === "EMPLOYEE" || me.role === "ADMIN" ? "Staff posts" : "Your maker posts"}
          </p>
        </div>
        <Link
          href="/dashboard/blog/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
        >
          + New Post
        </Link>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-xl border p-10 text-center text-neutral-500">
          No posts yet.{" "}
          <Link href="/dashboard/blog/new" className="underline text-neutral-700">
            Write your first post
          </Link>
        </div>
      ) : (
        <ul className="divide-y border rounded-xl overflow-hidden">
          {posts.map((p) => (
            <li key={p.id} className="flex items-center gap-4 px-4 py-3 bg-white hover:bg-neutral-50">
              <div className="flex-1 min-w-0">
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
                    ? `Published ${new Date(p.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                    : "Not published"}
                  {p.readingTimeMinutes ? ` · ${p.readingTimeMinutes} min read` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {p.status === "PUBLISHED" && (
                  <Link
                    href={`/blog/${p.slug}`}
                    className="text-xs rounded border px-2 py-1 hover:bg-neutral-50"
                    target="_blank"
                  >
                    View
                  </Link>
                )}
                <Link
                  href={`/dashboard/blog/${p.id}/edit`}
                  className="text-xs rounded border px-2 py-1 hover:bg-neutral-50"
                >
                  Edit
                </Link>
                <form action={deletePost.bind(null, p.id)}>
                  <ConfirmButton
                    confirm="Delete this post?"
                    className="text-xs rounded border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </ConfirmButton>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
