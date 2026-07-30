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
import { sanitizeRichText, truncateText } from "@/lib/sanitize";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { logServerError } from "@/lib/serverErrorLogger";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { openCaseWithFixedAuthority } from "@/lib/caseOpenAuthority";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";
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

function caseOpenFailureResponse(error: unknown) {
  const sqlState = getPrismaRawSqlState(error);
  if (sqlState === null) return null;
  if (sqlState === "22023") {
    return privateJson(
      { error: "The requested Case is invalid." },
      { status: 400 },
    );
  }
  if (sqlState === "23503") {
    return privateJson({ error: "Order not found." }, { status: 404 });
  }
  if (sqlState === "42501") {
    return privateJson({ error: "Forbidden." }, { status: 403 });
  }
  if (
    sqlState === "23505"
    || sqlState === "23514"
    || sqlState === "40001"
  ) {
    return privateJson(
      {
        error:
          "This order is not currently eligible for a new Case. Refresh and try again.",
      },
      { status: 409 },
    );
  }
  return null;
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

    let result;
    try {
      result = await openCaseWithFixedAuthority({
        actorUserId: me.id,
        orderId,
        reason,
        description,
      });
    } catch (error) {
      const response = caseOpenFailureResponse(error);
      if (response) return response;
      throw error;
    }
    if (result.action === "replay") {
      return privateJson(
        { error: "A case is already open for this order." },
        { status: 409 },
      );
    }

    try {
      await createNotification({
        userId: result.sellerUserId,
        type: "CASE_OPENED",
        title: `${me.name ?? "A buyer"} opened a case`,
        body: truncateText(description, 60),
        link: `/dashboard/sales/${result.orderId}`,
        relatedUserId: result.buyerUserId,
        sourceType: NOTIFICATION_SOURCE_TYPES.CASE,
        sourceId: result.caseId,
      });
    } catch (notificationError) {
      Sentry.captureException(notificationError, {
        level: "warning",
        tags: { source: "case_open_notification" },
        extra: {
          caseId: result.caseId,
          orderId: result.orderId,
          sellerId: result.sellerUserId,
        },
      });
    }

    try {
      if (
        await shouldSendEmail(
          result.sellerUserId,
          "EMAIL_CASE_OPENED",
        )
      ) {
        const sellerUser = await prisma.user.findUnique({
          where: { id: result.sellerUserId },
          select: { name: true, email: true },
        });
        if (sellerUser?.email) {
          await sendCaseOpened({
            orderId: result.orderId,
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
        extra: {
          caseId: result.caseId,
          orderId: result.orderId,
          sellerId: result.sellerUserId,
        },
      });
    }

    return privateJson(
      {
        id: result.caseId,
        orderId: result.orderId,
        buyerId: result.buyerUserId,
        sellerId: result.sellerUserId,
        reason: result.reason,
        status: result.status,
      },
      { status: 201 },
    );
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    logServerError(err, { source: "case_create_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
