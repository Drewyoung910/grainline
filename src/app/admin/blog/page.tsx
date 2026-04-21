// src/app/admin/blog/page.tsx
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";
import { createNotification } from "@/lib/notifications";

async function approveComment(commentId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/");
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { role: true } });
  if (!me || (me.role !== "EMPLOYEE" && me.role !== "ADMIN")) redirect("/");
  await prisma.blogComment.update({ where: { id: commentId }, data: { approved: true } });

  // Send notification now that the comment is approved
  try {
    const comment = await prisma.blogComment.findUnique({
      where: { id: commentId },
      select: {
        body: true,
        parentId: true,
        authorId: true,
        author: { select: { name: true, email: true } },
        post: { select: { slug: true, title: true, authorId: true } },
      },
    });
    if (comment) {
      const commenterName = comment.author.name ?? comment.author.email?.split("@")[0] ?? "Someone";
      if (comment.parentId) {
        // Reply — notify the parent comment author
        const parent = await prisma.blogComment.findUnique({
          where: { id: comment.parentId },
          select: { authorId: true },
        });
        if (parent && parent.authorId !== comment.authorId) {
          await createNotification({
            userId: parent.authorId,
            type: "BLOG_COMMENT_REPLY",
            title: `${commenterName} replied to your comment`,
            body: comment.body.slice(0, 60),
            link: `/blog/${comment.post.slug}`,
          });
        }
      } else {
        // Top-level comment — notify the post author
        if (comment.post.authorId !== comment.authorId) {
          await createNotification({
            userId: comment.post.authorId,
            type: "NEW_BLOG_COMMENT",
            title: `${commenterName} commented on your post`,
            body: comment.body.slice(0, 60),
            link: `/blog/${comment.post.slug}`,
          });
        }
      }
    }
  } catch { /* non-fatal — approval succeeded even if notification fails */ }

  revalidatePath("/admin/blog");
}

async function deleteComment(commentId: string) {
  "use server";
  const { userId } = await auth();
  if (!userId) redirect("/");
  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { role: true } });
  if (!me || (me.role !== "EMPLOYEE" && me.role !== "ADMIN")) redirect("/");
  await prisma.blogComment.delete({ where: { id: commentId } });
  revalidatePath("/admin/blog");
}

export default async function AdminBlogPage() {
  const posts = await prisma.blogPost.findMany({
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true, slug: true, title: true, type: true, status: true,
      publishedAt: true,
      author: { select: { name: true, email: true } },
      _count: { select: { comments: { where: { approved: false } } } },
    },
  });

  const pendingComments = await prisma.blogComment.findMany({
    where: { approved: false },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: {
      id: true, body: true, createdAt: true,
      author: { select: { name: true, email: true } },
      post: { select: { title: true, slug: true } },
    },
  });

  const STATUS_COLORS: Record<string, string> = {
    DRAFT: "bg-neutral-100 text-neutral-600",
    PUBLISHED: "bg-green-100 text-green-800",
    ARCHIVED: "bg-stone-100 text-stone-600",
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Blog</h1>
      </div>

      {/* Pending comments */}
      {pendingComments.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            Pending Comments
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {pendingComments.length}
            </span>
          </h2>
          <div className="space-y-3">
            {pendingComments.map((c) => (
              <div key={c.id} className="rounded-xl border bg-white p-4 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="text-xs text-neutral-500">
                    <span className="font-medium text-neutral-700">{c.author.name ?? c.author.email}</span>
                    {" on "}
                    <Link href={`/blog/${c.post.slug}`} target="_blank" className="underline">
                      {c.post.title}
                    </Link>
                    {" · "}
                    {new Date(c.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <form action={approveComment.bind(null, c.id)}>
                      <button type="submit" className="rounded border border-green-300 px-3 py-1 text-xs text-green-700 hover:bg-green-50">
                        Approve
                      </button>
                    </form>
                    <form action={deleteComment.bind(null, c.id)}>
                      <button type="submit" className="rounded border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50">
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
                <p className="text-sm text-neutral-700 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* All posts */}
      <section>
        <h2 className="text-lg font-semibold mb-3">All Posts ({posts.length})</h2>
        {posts.length === 0 ? (
          <div className="rounded-xl border p-8 text-neutral-500 text-sm">No posts yet.</div>
        ) : (
          <ul className="divide-y border rounded-xl overflow-hidden">
            {posts.map((p) => (
              <li key={p.id} className="flex items-center gap-4 px-4 py-3 bg-white hover:bg-neutral-50">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[p.type]}`}>
                      {BLOG_TYPE_LABELS[p.type]}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[p.status] ?? ""}`}>
                      {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                    </span>
                    {p._count.comments > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                        {p._count.comments} pending
                      </span>
                    )}
                  </div>
                  <div className="font-medium truncate">{p.title}</div>
                  <div className="text-xs text-neutral-500">
                    by {p.author.name ?? p.author.email}
                    {p.publishedAt && ` · ${new Date(p.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {p.status === "PUBLISHED" && (
                    <Link href={`/blog/${p.slug}`} target="_blank" className="text-xs rounded border px-2 py-1 hover:bg-neutral-50">
                      View
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
