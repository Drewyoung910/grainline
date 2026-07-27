import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { auth } from "@clerk/nextjs/server";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { requireStaffAdminPinForApi } from "@/lib/adminPinApi";
import { caseEvidenceAttachmentsEnabled } from "@/lib/caseEvidenceRelease";
import { prisma } from "@/lib/db";
import { readDirectUploadCaseAttachment } from "@/lib/directUploadLifecycle";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import {
  caseEvidenceReadRatelimit,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { privateR2BucketName, r2 } from "@/lib/r2";

export const runtime = "nodejs";

const CASE_EVIDENCE_SIGNED_URL_TTL_SECONDS = 60;

export async function GET(
  req: Request,
  {
    params,
  }: {
    params: Promise<{ id: string; attachmentId: string }>;
  },
) {
  if (!caseEvidenceAttachmentsEnabled()) {
    return privateJson({ error: "Not found." }, { status: 404 });
  }

  const { id, attachmentId } = await params;
  const { userId, sessionId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(
    caseEvidenceReadRatelimit,
    userId,
  );
  if (!success) {
    return privateResponse(
      rateLimitResponse(reset, "Too many evidence requests."),
    );
  }

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (error) {
    const accountResponse = accountAccessErrorResponse(error);
    if (accountResponse) return accountResponse;
    throw error;
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    select: {
      buyerId: true,
      sellerId: true,
    },
  });
  if (!caseRecord) {
    return privateJson({ error: "Case not found." }, { status: 404 });
  }

  const isParty =
    me.id === caseRecord.buyerId || me.id === caseRecord.sellerId;
  const isStaff = me.role === "EMPLOYEE" || me.role === "ADMIN";
  if (!isParty && !isStaff) {
    return privateJson({ error: "Forbidden." }, { status: 403 });
  }
  if (!isParty && isStaff) {
    const pinResponse = await requireStaffAdminPinForApi(req, userId, sessionId);
    if (pinResponse) return pinResponse;
  }

  const lifecycle = await readDirectUploadCaseAttachment({
    userId: me.id,
    caseId: id,
    attachmentId,
  });
  if (!lifecycle) {
    return privateJson({ error: "Evidence not found." }, { status: 404 });
  }

  const signedUrl = await getSignedUrl(
    r2,
    new GetObjectCommand({
      Bucket: privateR2BucketName(),
      Key: lifecycle.key,
      ResponseContentType: lifecycle.contentType,
      ResponseContentDisposition: "inline",
      ResponseCacheControl: "private, no-store",
    }),
    { expiresIn: CASE_EVIDENCE_SIGNED_URL_TTL_SECONDS },
  );

  return new Response(null, {
    status: 307,
    headers: {
      Location: signedUrl,
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
