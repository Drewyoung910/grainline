import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { z } from "zod";
import { reportRatelimit, safeRateLimit } from "@/lib/ratelimit";

const Schema = z.object({
  reason: z.enum(["SPAM", "HARASSMENT", "FAKE_LISTING", "INAPPROPRIATE", "OTHER"]),
  details: z.string().max(500).optional(),
  targetType: z.enum([
    "USER",
    "LISTING",
    "ORDER",
    "MESSAGE",
    "MESSAGE_THREAD",
    "BLOG_POST",
    "BLOG_COMMENT",
    "REVIEW",
    "COMMISSION_REQUEST",
  ]).optional(),
  targetId: z.string().max(100).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rl = await safeRateLimit(reportRatelimit, me.id);
  if (!rl.success) return NextResponse.json({ error: "Too many reports" }, { status: 429 });

  const { id: reportedId } = await params;
  if (reportedId === me.id) return NextResponse.json({ error: "Cannot report yourself" }, { status: 400 });

  const reportedUser = await prisma.user.findUnique({
    where: { id: reportedId },
    select: { id: true, deletedAt: true },
  });
  if (!reportedUser || reportedUser.deletedAt) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  let body;
  try {
    body = Schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if ((body.targetType && !body.targetId) || (!body.targetType && body.targetId)) {
    return NextResponse.json({ error: "targetType and targetId must be provided together" }, { status: 400 });
  }

  if (body.targetType && body.targetId) {
    let exists = false;
    switch (body.targetType) {
      case "USER":
        exists = body.targetId === reportedId;
        break;
      case "LISTING":
        exists = await prisma.listing.count({ where: { id: body.targetId, seller: { userId: reportedId } } }) > 0;
        break;
      case "ORDER":
        exists = await prisma.order.count({ where: { id: body.targetId, OR: [{ buyerId: reportedId }, { items: { some: { listing: { seller: { userId: reportedId } } } } }] } }) > 0;
        break;
      case "MESSAGE":
        exists = await prisma.message.count({ where: { id: body.targetId, OR: [{ senderId: reportedId }, { recipientId: reportedId }] } }) > 0;
        break;
      case "MESSAGE_THREAD":
        exists = await prisma.conversation.count({
          where: { id: body.targetId, OR: [{ userAId: reportedId }, { userBId: reportedId }] },
        }) > 0;
        break;
      case "BLOG_POST":
        exists = await prisma.blogPost.count({ where: { id: body.targetId, authorId: reportedId } }) > 0;
        break;
      case "BLOG_COMMENT":
        exists = await prisma.blogComment.count({ where: { id: body.targetId, authorId: reportedId } }) > 0;
        break;
      case "REVIEW":
        exists = await prisma.review.count({
          where: {
            id: body.targetId,
            OR: [
              { reviewerId: reportedId },
              { listing: { seller: { userId: reportedId } } },
            ],
          },
        }) > 0;
        break;
      case "COMMISSION_REQUEST":
        exists = await prisma.commissionRequest.count({ where: { id: body.targetId, buyerId: reportedId } }) > 0;
        break;
    }
    if (!exists) {
      return NextResponse.json({ error: "Invalid report target" }, { status: 400 });
    }
  }

  await prisma.userReport.create({
    data: { reporterId: me.id, reportedId, reason: body.reason, details: body.details, targetType: body.targetType ?? null, targetId: body.targetId ?? null },
  });

  return NextResponse.json({ ok: true });
}
