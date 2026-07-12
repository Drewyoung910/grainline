// src/app/api/blog/[slug]/save/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { blogSaveRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import {
  deleteOwnerSavedBlogPost,
  findOwnerSavedBlogPost,
  upsertOwnerSavedBlogPost,
} from "@/lib/savedBlogPostOwnerAccess";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";

async function getPost(slug: string) {
  return prisma.blogPost.findFirst({ where: publicBlogPostWhere({ slug }), select: { id: true } });
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
  if (!userId) return privateJson({ saved: false });

  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return privateJson({ saved: false });
    throw err;
  }

  const post = await getPost(slug);
  if (!me || !post) return privateJson({ saved: false });

  const existing = await findOwnerSavedBlogPost(me.id, post.id);
  return privateJson({ saved: !!existing });
}

// POST — save
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(blogSaveRatelimit, userId);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "Too many save actions."));

  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const post = await getPost(slug);
  if (!post) return privateJson({ error: "Not found" }, { status: 404 });

  await upsertOwnerSavedBlogPost(me.id, post.id);
  return privateJson({ saved: true });
}

// DELETE — unsave
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(blogSaveRatelimit, userId);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "Too many save actions."));

  let me: Awaited<ReturnType<typeof getMe>>;
  try {
    me = await getMe(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const post = await getPost(slug);
  if (!post) return privateJson({ saved: false });

  await deleteOwnerSavedBlogPost(me.id, post.id);
  return privateJson({ saved: false });
}
