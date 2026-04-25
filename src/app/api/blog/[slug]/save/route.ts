// src/app/api/blog/[slug]/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { blogSaveRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";

async function getPost(slug: string) {
  return prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
}

async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!user || user.banned || user.deletedAt) return null;
  return { id: user.id };
}

// GET — check if saved
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ saved: false });

  const [me, post] = await Promise.all([getMe(userId), getPost(slug)]);
  if (!me || !post) return NextResponse.json({ saved: false });

  const existing = await prisma.savedBlogPost.findUnique({
    where: { userId_blogPostId: { userId: me.id, blogPostId: post.id } },
    select: { id: true },
  });
  return NextResponse.json({ saved: !!existing });
}

// POST — save
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(blogSaveRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many save actions.");

  const [me, post] = await Promise.all([getMe(userId), getPost(slug)]);
  if (!me || !post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.savedBlogPost.upsert({
    where: { userId_blogPostId: { userId: me.id, blogPostId: post.id } },
    create: { userId: me.id, blogPostId: post.id },
    update: {},
  });
  return NextResponse.json({ saved: true });
}

// DELETE — unsave
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(blogSaveRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many save actions.");

  const [me, post] = await Promise.all([getMe(userId), getPost(slug)]);
  if (!me || !post) return NextResponse.json({ saved: false });

  await prisma.savedBlogPost.deleteMany({
    where: { userId: me.id, blogPostId: post.id },
  });
  return NextResponse.json({ saved: false });
}
