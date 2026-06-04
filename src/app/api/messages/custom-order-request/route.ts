import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { sendCustomOrderRequest } from "@/lib/email";
import { customOrderRequestRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { sellerOrderBlockMessage, sellerOrderBlockReason } from "@/lib/sellerOrderState";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { parseMoneyInputToCents } from "@/lib/money";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";
import { privateJson, privateResponse } from "@/lib/privateResponse";

const TIMELINE_LABELS: Record<string, string> = {
  no_rush: "No rush (2+ months)",
  "2_months": "Within 2 months",
  "1_month": "Within 1 month",
  "2_weeks": "Within 2 weeks",
};

const BudgetInputSchema = z.union([z.string().max(20), z.number().finite()]);

const CustomOrderRequestSchema = z.object({
  sellerUserId: z.string().min(1),
  description: z.string().min(1).max(500),
  dimensions: z.string().max(200).optional().nullable(),
  budget: BudgetInputSchema.optional().nullable(),
  timeline: z.string().max(50).optional().nullable(),
  listingId: z.string().min(1).optional().nullable(),
  listingTitle: z.string().max(200).optional().nullable(),
});
const CUSTOM_ORDER_REQUEST_BODY_MAX_BYTES = 24 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(customOrderRequestRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many custom order requests. Try again later."));

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, name: true, email: true, banned: true, deletedAt: true },
  });
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt) return privateJson({ error: "Account is suspended" }, { status: 403 });

  let parsed;
  try {
    parsed = CustomOrderRequestSchema.parse(await readBoundedJson(req, CUSTOM_ORDER_REQUEST_BODY_MAX_BYTES));
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return privateJson({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(e)) {
      return privateJson({ error: "Invalid JSON" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return privateJson({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    throw e;
  }

  const { sellerUserId, description, dimensions, budget, timeline, listingId } = parsed;
  const cleanedDescription = truncateText(sanitizeText(description.trim()), 500);
  const cleanedDimensions = dimensions ? truncateText(sanitizeText(dimensions.trim()), 200) : null;

  if (me.id === sellerUserId) {
    return privateJson({ error: "Cannot message yourself" }, { status: 400 });
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
    return privateJson({ error: "Unable to send request." }, { status: 403 });
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
          acceptingNewOrders: true,
          stripeAccountId: true,
          stripeAccountVersion: true,
          chargesEnabled: true,
          vacationMode: true,
        },
      },
    },
  });
  if (!seller) return privateJson({ error: "Seller not found" }, { status: 404 });
  if (seller.banned || seller.deletedAt) return privateJson({ error: "Seller not found" }, { status: 404 });
  if (!seller.sellerProfile) return privateJson({ error: "This user is not a seller." }, { status: 400 });
  if (!seller.sellerProfile.acceptsCustomOrders) return privateJson({ error: "This seller is not accepting custom orders." }, { status: 400 });
  const sellerBlockReason = sellerOrderBlockReason({ ...seller.sellerProfile, user: seller });
  if (sellerBlockReason) {
    return privateJson({ error: sellerOrderBlockMessage(sellerBlockReason) }, { status: 400 });
  }
  if (!seller.sellerProfile.chargesEnabled || !seller.sellerProfile.stripeAccountId) {
    return privateJson({ error: "This seller is not accepting new orders right now." }, { status: 400 });
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
      return privateJson({ error: "Invalid listing context." }, { status: 400 });
    }
    contextListingId = listing.id;
    contextListingTitle = listing.title;
  }

  const budgetCents = budget != null ? parseMoneyInputToCents(budget) : null;
  if (budget != null && (budgetCents === null || budgetCents <= 0)) {
    return privateJson({ error: "Budget must be a valid dollar amount." }, { status: 400 });
  }
  if (budgetCents !== null && budgetCents > 10_000_000) {
    return privateJson({ error: "Budget cannot exceed $100,000." }, { status: 400 });
  }
  const budgetNum = budgetCents !== null ? budgetCents / 100 : null;
  const timelineStr = timeline ? truncateText(sanitizeText(timeline), 50) : null;
  const timelineLabel = timelineStr ? (TIMELINE_LABELS[timelineStr] ?? timelineStr) : null;

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
  if (!convo) return privateJson({ error: "Failed to create conversation" }, { status: 500 });

  // Attach listing context if not already set
  if (contextListingId && !convo.contextListingId) {
    await prisma.conversation.update({
      where: { id: convo.id },
      data: { contextListingId },
    });
  }

  const messageBody = JSON.stringify({
    description: cleanedDescription,
    dimensions: cleanedDimensions,
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

  try {
    await createNotification({
      userId: sellerUserId,
      type: "CUSTOM_ORDER_REQUEST",
      title: `${me.name ?? "A customer"} wants a custom piece!`,
      body: truncateText(cleanedDescription, 60),
      link: `/messages/${convo.id}`,
    });
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "custom_order_request_notification" },
      extra: { conversationId: convo.id, buyerId: me.id, sellerUserId },
    });
  }

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
          description: cleanedDescription,
          conversationId: convo.id,
        });
      }
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "custom_order_request_email" },
      extra: { conversationId: convo.id, buyerId: me.id, sellerUserId },
    });
  }

  return privateJson({ conversationId: convo.id });
}
