import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";
import { rateLimitResponse, reportRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { getPrismaRawSqlState } from "@/lib/prismaRawSqlError";
import {
  createUserReport,
  USER_REPORT_TARGET_TYPES,
} from "@/lib/userReportAccess";
import { codePointLength } from "@/lib/textLength";

const Schema = z.object({
  reason: z.enum(["SPAM", "HARASSMENT", "FAKE_LISTING", "INAPPROPRIATE", "OTHER"]),
  details: z.string().refine((value) => codePointLength(value) <= 500).optional(),
  targetType: z.enum(USER_REPORT_TARGET_TYPES).optional(),
  targetId: z.string().max(100).optional(),
});
const USER_REPORT_BODY_MAX_BYTES = 24 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

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

  const details = body.details ? truncateText(sanitizeText(body.details), 500) || null : null;
  let report;
  try {
    report = await createUserReport({
      actorUserId: me.id,
      reportedUserId: reportedId,
      reason: body.reason,
      details,
      targetType: body.targetType ?? null,
      targetId: body.targetId ?? null,
    });
  } catch (error) {
    const sqlState = getPrismaRawSqlState(error);
    if (sqlState === "22023") {
      return privateJson({ error: "Invalid report target" }, { status: 400 });
    }
    if (sqlState === "42501") {
      return privateJson({ error: "User not found" }, { status: 404 });
    }
    throw error;
  }

  if (body.targetType === "LISTING" && body.targetId) {
    await createNotification({
      userId: reportedId,
      type: "LISTING_FLAGGED_BY_USER",
      title: "Listing report received",
      body: "A report about one of your listings was received and will be reviewed by Grainline staff.",
      link: `/dashboard/listings/${body.targetId}/edit`,
      sourceType: NOTIFICATION_SOURCE_TYPES.LISTING_USER_REPORT,
      sourceId: report.reportId,
      relatedUserId: me.id,
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
