// src/app/api/blog/[slug]/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { blogSaveRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";

async function getPost(slug: string) {
  return prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
}

async function getMe(userId: string) {
  return ensureUserByClerkId(userId);
}

// GET — check if saved
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ saved: false });

  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return NextResponse.json({ saved: false });
    throw err;
  }

  const post = await getPost(slug);
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

  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const post = await getPost(slug);
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

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

  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const post = await getPost(slug);
  if (!post) return NextResponse.json({ saved: false });

  await prisma.savedBlogPost.deleteMany({
    where: { userId: me.id, blogPostId: post.id },
  });
  return NextResponse.json({ saved: false });
}
