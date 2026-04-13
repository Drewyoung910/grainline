// src/app/api/blog/[slug]/comments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { createNotification } from "@/lib/notifications";
import { z } from "zod";

const CommentSchema = z.object({
  body: z.string().min(1).max(2000),
  parentId: z.string().min(1).optional(),
});

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const post = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
  if (!post) return NextResponse.json({ comments: [] });

  const comments = await prisma.blogComment.findMany({
    where: { postId: post.id, approved: true, parentId: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, imageUrl: true } },
      replies: {
        where: { approved: true },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, name: true, imageUrl: true } },
        },
      },
    },
  });

  return NextResponse.json({ comments });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true, name: true, email: true } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const post = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true, authorId: true, title: true } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let parsed;
  try {
    parsed = CommentSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = parsed.body.trim();
  const { parentId } = parsed;

  // Validate parent if provided
  if (parentId) {
    const parent = await prisma.blogComment.findUnique({
      where: { id: parentId },
      select: { id: true, postId: true, parentId: true, authorId: true },
    });
    if (!parent || parent.postId !== post.id) {
      return NextResponse.json({ error: "Invalid parent comment" }, { status: 400 });
    }
    if (parent.parentId !== null) {
      return NextResponse.json({ error: "Cannot reply to a reply" }, { status: 400 });
    }
  }

  const comment = await prisma.blogComment.create({
    data: { postId: post.id, authorId: me.id, body: text, approved: false, parentId: parentId ?? null },
    select: { id: true, body: true, createdAt: true, approved: true },
  });

  if (parentId) {
    // Notify parent comment author (if different from replier)
    const parent = await prisma.blogComment.findUnique({
      where: { id: parentId },
      select: { authorId: true },
    });
    if (parent && parent.authorId !== me.id) {
      await createNotification({
        userId: parent.authorId,
        type: "BLOG_COMMENT_REPLY",
        title: `${me.name ?? me.email?.split("@")[0] ?? "Someone"} replied to your comment`,
        body: text.slice(0, 60),
        link: `/blog/${slug}`,
      });
    }
  } else {
    // Notify post author (if they're not the commenter)
    if (post.authorId !== me.id) {
      await createNotification({
        userId: post.authorId,
        type: "NEW_BLOG_COMMENT",
        title: `${me.name ?? me.email?.split("@")[0] ?? "Someone"} commented on your post`,
        body: text.slice(0, 60),
        link: `/blog/${slug}`,
      });
    }
  }

  return NextResponse.json({ comment }, { status: 201 });
}
