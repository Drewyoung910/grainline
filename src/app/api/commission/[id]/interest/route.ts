// src/app/api/commission/[id]/interest/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import { commissionInterestRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { logSecurityEvent } from "@/lib/security";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(commissionInterestRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many interest expressions today.");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, name: true, sellerProfile: { select: { id: true, displayName: true, avatarImageUrl: true } } },
  });
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 401 });
  if (!me.sellerProfile) return NextResponse.json({ error: "Seller profile required" }, { status: 403 });

  const commissionRequest = await prisma.commissionRequest.findUnique({
    where: { id },
    select: {
      id: true,
      buyerId: true,
      title: true,
      description: true,
      status: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      timeline: true,
      buyer: { select: { id: true, name: true, email: true } },
    },
  });
  if (!commissionRequest) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (commissionRequest.status !== "OPEN") {
    return NextResponse.json({ error: "Commission request is no longer open" }, { status: 400 });
  }
  if (commissionRequest.buyerId === me.id) {
    logSecurityEvent("spam_attempt", { userId: me.id, route: "/api/commission/interest", reason: "interest on own commission" });
    return NextResponse.json({ error: "Cannot express interest in your own request" }, { status: 400 });
  }

  // Check if already expressed interest
  const existing = await prisma.commissionInterest.findUnique({
    where: {
      commissionRequestId_sellerProfileId: {
        commissionRequestId: id,
        sellerProfileId: me.sellerProfile.id,
      },
    },
  });
  if (existing) {
    // Return existing conversation if any
    return NextResponse.json({ conversationId: existing.conversationId, alreadyInterested: true });
  }

  // Upsert conversation (canonical sort, race-safe)
  const buyerUserId = commissionRequest.buyerId;
  const [a, b] = [me.id, buyerUserId].sort((x, y) => (x < y ? -1 : 1));

  let convo = await prisma.conversation.findUnique({
    where: { userAId_userBId: { userAId: a, userBId: b } },
  });
  if (!convo) {
    try {
      convo = await prisma.conversation.create({ data: { userAId: a, userBId: b } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        convo = await prisma.conversation.findUnique({
          where: { userAId_userBId: { userAId: a, userBId: b } },
        });
      } else {
        throw e;
      }
    }
  }
  if (!convo) return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 });

  // Create interest record + increment counter + link conversation
  await prisma.$transaction([
    prisma.commissionInterest.create({
      data: {
        commissionRequestId: id,
        sellerProfileId: me.sellerProfile.id,
        conversationId: convo.id,
      },
    }),
    prisma.commissionRequest.update({
      where: { id },
      data: { interestedCount: { increment: 1 } },
    }),
  ]);

  // Send a structured system message to the buyer
  const sellerDisplayName = me.sellerProfile.displayName ?? me.name ?? "A maker";
  void prisma.message.create({
    data: {
      conversationId: convo.id,
      senderId: me.id,
      recipientId: commissionRequest.buyerId,
      body: JSON.stringify({
        commissionId: id,
        commissionTitle: commissionRequest.title,
        sellerName: sellerDisplayName,
        budgetMinCents: commissionRequest.budgetMinCents,
        budgetMaxCents: commissionRequest.budgetMaxCents,
        timeline: commissionRequest.timeline,
      }),
      kind: "commission_interest_card",
      isSystemMessage: true,
    },
  }).catch(() => {});

  // Notify the buyer
  const sellerName = me.sellerProfile.displayName ?? me.name ?? "A maker";
  void createNotification({
    userId: commissionRequest.buyerId,
    type: "COMMISSION_INTEREST",
    title: `${sellerName} is interested in your commission`,
    body: `"${commissionRequest.title}" — view the conversation`,
    link: `/messages/${convo.id}`,
  });

  return NextResponse.json({ conversationId: convo.id, alreadyInterested: false });
}
