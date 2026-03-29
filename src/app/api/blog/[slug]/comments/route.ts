// src/app/api/blog/[slug]/comments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { createNotification } from "@/lib/notifications";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const post = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
  if (!post) return NextResponse.json({ comments: [] });

  const comments = await prisma.blogComment.findMany({
    where: { postId: post.id, approved: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, imageUrl: true } },
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

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const text = typeof body.body === "string" ? body.body.trim().slice(0, 2000) : "";
  if (!text) return NextResponse.json({ error: "body required" }, { status: 400 });

  const comment = await prisma.blogComment.create({
    data: { postId: post.id, authorId: me.id, body: text, approved: false },
    select: { id: true, body: true, createdAt: true, approved: true },
  });

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

  return NextResponse.json({ comment }, { status: 201 });
}
