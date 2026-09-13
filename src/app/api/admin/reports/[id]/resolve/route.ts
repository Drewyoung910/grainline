import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { logAdminActionOrThrow } from "@/lib/audit";
import { adminActionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { z } from "zod";

const ReportResolveSchema = z.object({
  reason: z.string().min(1).max(500),
});
const ADMIN_REPORT_RESOLVE_BODY_MAX_BYTES = 16 * 1024;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const admin = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, role: true, banned: true, deletedAt: true },
  });
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
  const resolutionNote = truncateText(sanitizeText(body.reason), 500);
  if (!resolutionNote) {
    return privateJson({ error: "Resolution reason is required." }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.userReport.updateMany({
      where: { id, resolved: false },
      data: { resolved: true, resolvedAt: new Date(), resolvedById: admin.id, resolutionNote },
    });
    if (result.count === 0) return result;
    await logAdminActionOrThrow({
      client: tx,
      adminId: admin.id,
      action: "RESOLVE_REPORT",
      targetType: "UserReport",
      targetId: id,
      metadata: {
        resolutionNoteStored: true,
        resolutionNoteLength: resolutionNote.length,
      },
    });
    return result;
  });
  if (updated.count === 0) {
    return privateJson({ error: "Report is already resolved or no longer exists." }, { status: HTTP_STATUS.NOT_FOUND });
  }

  return privateJson({ ok: true });
}
