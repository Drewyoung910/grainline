import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { createNotification } from "@/lib/notifications";
import { canViewListingDetail } from "@/lib/listingVisibility";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { openCommissionWhere } from "@/lib/commissionExpiry";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";
import { rateLimitResponse, reportRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { sanitizeText, truncateText } from "@/lib/sanitize";

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
const USER_REPORT_BODY_MAX_BYTES = 24 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const rl = await safeRateLimit(reportRatelimit, me.id);
  if (!rl.success) return privateResponse(rateLimitResponse(rl.reset, "Too many reports."));

  const { id: reportedId } = await params;
  if (reportedId === me.id) return privateJson({ error: "Cannot report yourself" }, { status: 400 });

  const reportedUser = await prisma.user.findUnique({
    where: { id: reportedId },
    select: { id: true, deletedAt: true },
  });
  if (!reportedUser || reportedUser.deletedAt) {
    return privateJson({ error: "User not found" }, { status: 404 });
  }

  let body;
  try {
    body = Schema.parse(await readBoundedJson(req, USER_REPORT_BODY_MAX_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(error) || error instanceof z.ZodError) {
      return privateJson({ error: "Invalid input" }, { status: 400 });
    }
    throw error;
  }

  if ((body.targetType && !body.targetId) || (!body.targetType && body.targetId)) {
    return privateJson({ error: "targetType and targetId must be provided together" }, { status: 400 });
  }

  if (body.targetType && body.targetId) {
    let exists = false;
    let reporterCanAccess = false;
    switch (body.targetType) {
      case "USER":
        exists = body.targetId === reportedId;
        reporterCanAccess = exists;
        break;
      case "LISTING":
        {
          const listing = await prisma.listing.findUnique({
            where: { id: body.targetId },
            select: {
              id: true,
              status: true,
              isPrivate: true,
              reservedForUserId: true,
              seller: {
                select: {
                  userId: true,
                  chargesEnabled: true,
                  stripeAccountVersion: true,
                  vacationMode: true,
                  user: { select: { id: true, clerkId: true, banned: true, deletedAt: true } },
                },
              },
            },
          });
          exists = listing?.seller.userId === reportedId;
          reporterCanAccess = !!listing && exists && canViewListingDetail(listing, { dbUserId: me.id });
        }
        break;
      case "ORDER":
        exists = await prisma.order.count({
          where: {
            id: body.targetId,
            OR: [{ buyerId: reportedId }, { items: { some: { listing: { seller: { userId: reportedId } } } } }],
            AND: [
              {
                OR: [
                  { buyerId: me.id },
                  { items: { some: { listing: { seller: { userId: me.id } } } } },
                ],
              },
            ],
          },
        }) > 0;
        reporterCanAccess = exists;
        break;
      case "MESSAGE":
        exists = await prisma.message.count({
          where: {
            id: body.targetId,
            OR: [{ senderId: reportedId }, { recipientId: reportedId }],
            conversation: { OR: [{ userAId: me.id }, { userBId: me.id }] },
          },
        }) > 0;
        reporterCanAccess = exists;
        break;
      case "MESSAGE_THREAD":
        exists = await prisma.conversation.count({
          where: {
            id: body.targetId,
            OR: [{ userAId: reportedId }, { userBId: reportedId }],
            AND: [{ OR: [{ userAId: me.id }, { userBId: me.id }] }],
          },
        }) > 0;
        reporterCanAccess = exists;
        break;
      case "BLOG_POST":
        exists = await prisma.blogPost.count({
          where: publicBlogPostWhere({ id: body.targetId, authorId: reportedId }),
        }) > 0;
        reporterCanAccess = exists;
        break;
      case "BLOG_COMMENT":
        exists = await prisma.blogComment.count({
          where: {
            id: body.targetId,
            authorId: reportedId,
            approved: true,
            post: publicBlogPostWhere(),
          },
        }) > 0;
        reporterCanAccess = exists;
        break;
      case "REVIEW":
        {
          const review = await prisma.review.findUnique({
            where: { id: body.targetId },
            select: {
              reviewerId: true,
              listing: {
                select: {
                  id: true,
                  status: true,
                  isPrivate: true,
                  reservedForUserId: true,
                  seller: {
                    select: {
                      userId: true,
                      chargesEnabled: true,
                      stripeAccountVersion: true,
                      vacationMode: true,
                      user: { select: { id: true, clerkId: true, banned: true, deletedAt: true } },
                    },
                  },
                },
              },
            },
          });
          exists = !!review && (review.reviewerId === reportedId || review.listing.seller.userId === reportedId);
          reporterCanAccess = !!review && exists && (
            review.reviewerId === me.id ||
            review.listing.seller.userId === me.id ||
            canViewListingDetail(review.listing, { dbUserId: me.id })
          );
        }
        break;
      case "COMMISSION_REQUEST":
        exists = await prisma.commissionRequest.count({
          where: openCommissionWhere({ id: body.targetId, buyerId: reportedId }),
        }) > 0;
        reporterCanAccess = exists;
        break;
    }
    if (!exists || !reporterCanAccess) {
      return privateJson({ error: "Invalid report target" }, { status: 400 });
    }
  }

  const details = body.details ? truncateText(sanitizeText(body.details), 500) || null : null;
  await prisma.userReport.create({
    data: { reporterId: me.id, reportedId, reason: body.reason, details, targetType: body.targetType ?? null, targetId: body.targetId ?? null },
  });

  if (body.targetType === "LISTING" && body.targetId) {
    await createNotification({
      userId: reportedId,
      type: "LISTING_FLAGGED_BY_USER",
      title: "Listing report received",
      body: "A report about one of your listings was received and will be reviewed by Grainline staff.",
      link: `/dashboard/listings/${body.targetId}/edit`,
    }).catch((notificationError) => {
      Sentry.captureException(notificationError, {
        level: "warning",
        tags: { source: "user_report_listing_notification" },
        extra: { reporterId: me.id, reportedId, targetId: body.targetId },
      });
    });
  }

  return privateJson({ ok: true });
}
