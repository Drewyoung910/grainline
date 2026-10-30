import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { userClerkGate } from "@/lib/userIdentityAccess";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { getOrderStaffReadClient } from "@/lib/orderStaffReadDb";
import { resolveUserReport } from "@/lib/userReportAccess";
import { codePointLength } from "@/lib/textLength";
import { z } from "zod";

const ReportResolveSchema = z.object({
  participantRationale: z.string()
    .refine((value) => codePointLength(value) >= 1 && codePointLength(value) <= 500),
  internalNote: z.string()
    .refine((value) => codePointLength(value) <= 1000)
    .optional(),
});
const ADMIN_REPORT_RESOLVE_BODY_MAX_BYTES = 16 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const admin = await userClerkGate(prisma, userId);
  if (!admin || admin.banned || admin.deletedAt || (admin.role !== "ADMIN" && admin.role !== "EMPLOYEE")) {
    return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
  }

  const { success, reset } = await safeRateLimit(adminActionRatelimit, admin.id);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many admin actions. Try again shortly."));

  const { id } = await params;
  let body;
  try {
    body = ReportResolveSchema.parse(await readBoundedJson(req, ADMIN_REPORT_RESOLVE_BODY_MAX_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    if (isInvalidJsonBodyError(error)) {
      return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    if (error instanceof z.ZodError) {
      return privateJson({ error: "Invalid input", details: error.issues }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    throw error;
  }
  const participantRationale = truncateText(sanitizeText(body.participantRationale), 500);
  const internalNote = body.internalNote
    ? truncateText(sanitizeText(body.internalNote), 1000) || null
    : null;
  if (!participantRationale) {
    return privateJson({ error: "Resolution reason is required." }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  const result = await resolveUserReport(getOrderStaffReadClient(), {
    actorUserId: admin.id,
    reportId: id,
    participantRationale,
    internalNote,
  });
  if (result === "UNCHANGED") {
    return privateJson({ error: "Report is already resolved or no longer exists." }, { status: HTTP_STATUS.NOT_FOUND });
  }

  return privateJson({ ok: true });
}
