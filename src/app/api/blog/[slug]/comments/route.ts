// src/app/api/blog/[slug]/comments/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { blogCommentRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { containsProfanity } from "@/lib/profanity";
import { z } from "zod";

const AUTHOR_SELECT = {
  id: true,
  name: true,
  imageUrl: true,
  sellerProfile: { select: { avatarImageUrl: true } },
} as const;

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
      author: { select: AUTHOR_SELECT },
      replies: {
        where: { approved: true },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: AUTHOR_SELECT },
          replies: {
            where: { approved: true },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              body: true,
              createdAt: true,
              author: { select: AUTHOR_SELECT },
            },
          },
        },
      },
    },
  });

  const mapped = comments.map((c) => ({
    ...c,
    avatarUrl: c.author.sellerProfile?.avatarImageUrl ?? c.author.imageUrl,
    replies: c.replies.map((r) => ({
      ...r,
      avatarUrl: r.author.sellerProfile?.avatarImageUrl ?? r.author.imageUrl,
      replies: r.replies.map((r3) => ({
        ...r3,
        avatarUrl: r3.author.sellerProfile?.avatarImageUrl ?? r3.author.imageUrl,
      })),
    })),
  }));

  return NextResponse.json({ comments: mapped });
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

  const { success: rlOk, reset } = await safeRateLimit(blogCommentRatelimit, me.id);
  if (!rlOk) return rateLimitResponse(reset, "Too many comments.");

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

  // Profanity check (log-only — does not block submission)
  {
    const profanityResult = containsProfanity(text);
    if (profanityResult.flagged) {
      console.error(`[PROFANITY] Blog comment flagged — matches: ${profanityResult.matches.join(", ")}`);
    }
  }

  // Validate parent and determine effective parentId for depth enforcement
  let effectiveParentId: string | null = null;
  let notifyAuthorId: string | null = null;

  if (parentId) {
    const parent = await prisma.blogComment.findUnique({
      where: { id: parentId },
      select: { id: true, postId: true, parentId: true, authorId: true },
    });
    if (!parent || parent.postId !== post.id) {
      return NextResponse.json({ error: "Invalid parent comment" }, { status: 400 });
    }

    if (parent.parentId === null) {
      // Parent is level 1 → new comment becomes level 2
      effectiveParentId = parent.id;
    } else {
      // Parent is level 2 or deeper → check grandparent
      const grandparent = await prisma.blogComment.findUnique({
        where: { id: parent.parentId },
        select: { id: true, parentId: true, postId: true },
      });
      if (!grandparent || grandparent.postId !== post.id) {
        return NextResponse.json({ error: "Invalid parent comment" }, { status: 400 });
      }
      if (grandparent.parentId === null) {
        // Grandparent is level 1, parent is level 2 → new comment becomes level 3
        effectiveParentId = parent.id;
      } else {
        // Already at level 3 or deeper → flatten to level 3 by attaching to parent's parent (level 2)
        effectiveParentId = parent.parentId;
      }
    }
    notifyAuthorId = parent.authorId !== me.id ? parent.authorId : null;
  }

  const comment = await prisma.blogComment.create({
    data: { postId: post.id, authorId: me.id, body: text, approved: false, parentId: effectiveParentId },
    select: { id: true, body: true, createdAt: true, approved: true },
  });

  // Notifications are sent when the comment is approved by admin (see admin/blog/page.tsx),
  // not here — unapproved comments should not trigger notifications.

  return NextResponse.json({ comment }, { status: 201 });
}
