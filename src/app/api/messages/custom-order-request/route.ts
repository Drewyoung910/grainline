import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendCustomOrderRequest } from "@/lib/email";
import { customOrderRequestRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { truncateText } from "@/lib/sanitize";
import { z } from "zod";

const TIMELINE_LABELS: Record<string, string> = {
  no_rush: "No rush (2+ months)",
  "2_months": "Within 2 months",
  "1_month": "Within 1 month",
  "2_weeks": "Within 2 weeks",
};

const CustomOrderRequestSchema = z.object({
  sellerUserId: z.string().min(1),
  description: z.string().min(1).max(500),
  dimensions: z.string().max(200).optional().nullable(),
  budget: z.number().positive().optional().nullable(),
  timeline: z.string().max(50).optional().nullable(),
  listingId: z.string().min(1).optional().nullable(),
  listingTitle: z.string().max(200).optional().nullable(),
});

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(customOrderRequestRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many custom order requests. Try again later.");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, name: true, email: true, banned: true, deletedAt: true },
  });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt) return NextResponse.json({ error: "Account is suspended" }, { status: 403 });

  let parsed;
  try {
    parsed = CustomOrderRequestSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sellerUserId, description, dimensions, budget, timeline, listingId } = parsed;

  if (me.id === sellerUserId) {
    return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 });
  }

  // Block check — cannot send custom order request if either user blocked the other
  const blockExists = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: sellerUserId },
        { blockerId: sellerUserId, blockedId: me.id },
      ],
    },
  });
  if (blockExists) {
    return NextResponse.json({ error: "Unable to send request." }, { status: 403 });
  }

  const seller = await prisma.user.findUnique({
    where: { id: sellerUserId },
    select: {
      id: true,
      banned: true,
      deletedAt: true,
      sellerProfile: {
        select: {
          id: true,
          acceptsCustomOrders: true,
          chargesEnabled: true,
          vacationMode: true,
        },
      },
    },
  });
  if (!seller) return NextResponse.json({ error: "Seller not found" }, { status: 404 });
  if (seller.banned || seller.deletedAt) return NextResponse.json({ error: "Seller not found" }, { status: 404 });
  if (!seller.sellerProfile) return NextResponse.json({ error: "This user is not a seller." }, { status: 400 });
  if (!seller.sellerProfile.acceptsCustomOrders) return NextResponse.json({ error: "This seller is not accepting custom orders." }, { status: 400 });
  if (!seller.sellerProfile.chargesEnabled || seller.sellerProfile.vacationMode) {
    return NextResponse.json({ error: "This seller is not accepting new orders right now." }, { status: 400 });
  }

  let contextListingId: string | null = null;
  let contextListingTitle: string | null = null;
  if (listingId) {
    const listing = await prisma.listing.findFirst({
      where: {
        id: listingId,
        sellerId: seller.sellerProfile.id,
        status: "ACTIVE",
        isPrivate: false,
      },
      select: { id: true, title: true },
    });
    if (!listing) {
      return NextResponse.json({ error: "Invalid listing context." }, { status: 400 });
    }
    contextListingId = listing.id;
    contextListingTitle = listing.title;
  }

  // Upsert conversation (canonical sort, race-safe — same logic as /messages/new)
  const [a, b] = [me.id, sellerUserId].sort((x, y) => (x < y ? -1 : 1));
  let convo = await prisma.conversation.findUnique({
    where: { userAId_userBId: { userAId: a, userBId: b } },
  });
  if (!convo) {
    try {
      convo = await prisma.conversation.create({
        data: {
          userAId: a,
          userBId: b,
          contextListingId: contextListingId ?? undefined,
        },
      });
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

  // Attach listing context if not already set
  if (contextListingId && !convo.contextListingId) {
    await prisma.conversation.update({
      where: { id: convo.id },
      data: { contextListingId },
    });
  }

  const budgetNum = budget && budget > 0 ? budget : null;
  const timelineStr = timeline ?? null;
  const timelineLabel = timelineStr ? (TIMELINE_LABELS[timelineStr] ?? timelineStr) : null;

  const messageBody = JSON.stringify({
    description: truncateText(description.trim(), 500),
    dimensions: dimensions?.trim() || null,
    budget: budgetNum,
    timeline: timelineStr,
    timelineLabel,
    listingId: contextListingId,
    listingTitle: contextListingTitle,
  });

  await prisma.message.create({
    data: {
      conversationId: convo.id,
      senderId: me.id,
      recipientId: sellerUserId,
      body: messageBody,
      kind: "custom_order_request",
    },
  });

  await prisma.conversation.update({
    where: { id: convo.id },
    data: { updatedAt: new Date() },
  });

  await createNotification({
    userId: sellerUserId,
    type: "CUSTOM_ORDER_REQUEST",
    title: `${me.name ?? me.email?.split("@")[0] ?? "Someone"} wants a custom piece!`,
    body: truncateText(String(description).trim(), 60),
    link: `/messages/${convo.id}`,
  });

  try {
    if (await shouldSendEmail(sellerUserId, "EMAIL_CUSTOM_ORDER")) {
      const sellerUser = await prisma.user.findUnique({
        where: { id: sellerUserId },
        select: { name: true, email: true, sellerProfile: { select: { displayName: true } } },
      });
      if (sellerUser?.email) {
        const buyerUser = await prisma.user.findUnique({
          where: { id: me.id },
          select: { name: true },
        });
        await sendCustomOrderRequest({
          seller: {
            displayName: sellerUser.sellerProfile?.displayName ?? sellerUser.name,
            email: sellerUser.email,
          },
          buyerName: buyerUser?.name,
          description: String(description).trim(),
          conversationId: convo.id,
        });
      }
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({ conversationId: convo.id });
}
