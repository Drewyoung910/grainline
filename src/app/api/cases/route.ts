// src/app/api/cases/route.ts
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { sendCaseOpened } from "@/lib/email";
import {
  caseCreateRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import {
  blockingRefundLedgerWhere,
  orderHasRefundLedger,
} from "@/lib/refundRouteState";
import { logUserAuditActionOrThrow } from "@/lib/audit";
import {
  databaseClockTimestamp,
  lockOrderForCaseLifecycle,
} from "@/lib/caseLifecycleLocks";
import {
  caseEstimatedDeliveryBlockMessage,
  caseWindowClosedMessage,
  caseWindowClosesAt,
  isOrderCaseWindowClosed,
} from "@/lib/caseCreateState";
import { sanitizeRichText, truncateText } from "@/lib/sanitize";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { z } from "zod";

export const runtime = "nodejs";

const CaseCreateSchema = z.object({
  orderId: z.string().min(1),
  reason: z.enum([
    "NOT_RECEIVED",
    "NOT_AS_DESCRIBED",
    "DAMAGED",
    "WRONG_ITEM",
    "OTHER",
  ]),
  description: z.string().min(1).max(2000),
});
const CASE_CREATE_BODY_MAX_BYTES = 24 * 1024;

class CaseCreateRouteError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CaseCreateRouteError";
  }
}

export async function POST(req: Request) {
  try {
    const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
    if (crossOriginRejection) {
      return privateJson({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

    const { success, reset } = await safeRateLimit(caseCreateRatelimit, userId);
    if (!success)
      return privateResponse(
        rateLimitResponse(reset, "Too many case submissions. Try again later."),
      );

    const me = await ensureUserByClerkId(userId);

    let parsed;
    try {
      parsed = CaseCreateSchema.parse(
        await readBoundedJson(req, CASE_CREATE_BODY_MAX_BYTES),
      );
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return privateJson(
          { error: "Request body too large" },
          { status: 413 },
        );
      }
      if (isInvalidJsonBodyError(e)) {
        return privateJson({ error: "Invalid JSON" }, { status: 400 });
      }
      if (e instanceof z.ZodError) {
        return privateJson(
          { error: "Invalid input", details: e.issues },
          { status: 400 },
        );
      }
      throw e;
    }
    const { orderId, reason } = parsed;
    const description = sanitizeRichText(parsed.description.trim());
    if (description.length < 20) {
      return privateJson(
        { error: "Description must be at least 20 characters." },
        { status: 400 },
      );
    }

    const { newCase, sellerId } = await prisma.$transaction(async (tx) => {
      const orderExists = await lockOrderForCaseLifecycle(tx, orderId);
      if (!orderExists) {
        throw new CaseCreateRouteError("Order not found.", 404);
      }

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          case: { select: { id: true } },
          paymentEvents: {
            where: blockingRefundLedgerWhere(),
            take: 1,
            select: { eventType: true, status: true },
          },
          items: {
            include: {
              listing: {
                select: {
                  seller: {
                    select: {
                      user: {
                        select: { id: true, banned: true, deletedAt: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!order) {
        throw new CaseCreateRouteError("Order not found.", 404);
      }
      if (order.buyerId !== me.id) {
        throw new CaseCreateRouteError("Forbidden.", 403);
      }
      if (order.case) {
        throw new CaseCreateRouteError(
          "A case already exists for this order.",
          409,
        );
      }
      if (orderHasRefundLedger(order) || order.sellerRefundId) {
        throw new CaseCreateRouteError(
          "A refund has already been issued or is being processed for this order.",
          400,
        );
      }

      const sellerUser = order.items[0]?.listing.seller.user;
      const sellerId = sellerUser?.id;
      if (
        !sellerId ||
        order.items.length === 0 ||
        order.items.some((item) => item.listing.seller.user.id !== sellerId)
      ) {
        throw new CaseCreateRouteError(
          "Could not determine one seller for this order.",
          409,
        );
      }
      const sellerUnavailable = Boolean(
        sellerUser?.banned || sellerUser?.deletedAt,
      );
      const fulfillmentStatus = order.fulfillmentStatus ?? "PENDING";
      const now = await databaseClockTimestamp(tx);
      if (
        order.labelStatus === "PURCHASED" &&
        fulfillmentStatus === "PENDING"
      ) {
        throw new CaseCreateRouteError(
          "A shipping label is currently being purchased for this order.",
          409,
        );
      }
      if (
        fulfillmentStatus === "PENDING" &&
        !sellerUnavailable &&
        !order.reviewNeeded
      ) {
        throw new CaseCreateRouteError(
          "Please wait until your order has shipped before opening a case.",
          400,
        );
      }
      if (
        order.estimatedDeliveryDate &&
        order.estimatedDeliveryDate > now &&
        !sellerUnavailable &&
        !order.reviewNeeded
      ) {
        throw new CaseCreateRouteError(
          caseEstimatedDeliveryBlockMessage(order.estimatedDeliveryDate),
          400,
        );
      }
      if (isOrderCaseWindowClosed(order, now)) {
        throw new CaseCreateRouteError(
          caseWindowClosedMessage(caseWindowClosesAt(order)),
          400,
        );
      }

      if (sellerId === me.id) {
        throw new CaseCreateRouteError(
          "Buyer and seller must be different accounts.",
          409,
        );
      }

      const newCase = await tx.case.create({
        data: {
          orderId,
          buyerId: me.id,
          sellerId,
          reason,
          description,
          sellerRespondBy: new Date(now.getTime() + 48 * 60 * 60 * 1000),
          messages: {
            create: {
              authorId: me.id,
              authorKind: "BUYER",
              body: description,
            },
          },
        },
        include: { messages: true },
      });

      await logUserAuditActionOrThrow({
        client: tx,
        actorId: me.id,
        action: "BUYER_OPEN_CASE",
        targetType: "CASE",
        targetId: newCase.id,
        metadata: { orderId, sellerId, reason },
      });

      return { newCase, sellerId };
    });

    try {
      await createNotification({
        userId: sellerId,
        type: "CASE_OPENED",
        title: `${me.name ?? "A buyer"} opened a case`,
        body: truncateText(description, 60),
        link: `/dashboard/sales/${orderId}`,
        relatedUserId: me.id,
        sourceType: NOTIFICATION_SOURCE_TYPES.CASE,
        sourceId: newCase.id,
      });
    } catch (notificationError) {
      Sentry.captureException(notificationError, {
        level: "warning",
        tags: { source: "case_open_notification" },
        extra: { caseId: newCase.id, orderId, sellerId },
      });
    }

    try {
      if (await shouldSendEmail(sellerId, "EMAIL_CASE_OPENED")) {
        const sellerUser = await prisma.user.findUnique({
          where: { id: sellerId },
          select: { name: true, email: true },
        });
        if (sellerUser?.email) {
          await sendCaseOpened({
            orderId,
            seller: { name: sellerUser.name, email: sellerUser.email },
            buyer: { name: me.name },
            caseDescription: description,
          });
        }
      }
    } catch (emailError) {
      Sentry.captureException(emailError, {
        level: "warning",
        tags: { source: "case_open_email" },
        extra: { caseId: newCase.id, orderId, sellerId },
      });
    }

    return privateJson(newCase, { status: 201 });
  } catch (err) {
    if (err instanceof CaseCreateRouteError) {
      return privateJson({ error: err.message }, { status: err.status });
    }
    if (isAccountAccessError(err)) {
      return privateJson(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    if ((err as { code?: string }).code === "P2002") {
      return privateJson(
        { error: "A case is already open for this order." },
        { status: 409 },
      );
    }
    logServerError(err, { source: "case_create_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
