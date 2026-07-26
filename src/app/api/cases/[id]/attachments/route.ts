import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import sharp from "sharp";
import { z } from "zod";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import {
  CASE_EVIDENCE_STORAGE_CLASS,
  CASE_EVIDENCE_UPLOAD_ENDPOINT,
  MAX_CASE_MESSAGE_ATTACHMENTS,
} from "@/lib/caseEvidence";
import { canCreateCaseMessageForStatus } from "@/lib/caseMessagingState";
import { prisma } from "@/lib/db";
import { recordDirectUploadVerified } from "@/lib/directUploadLifecycle";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import {
  rateLimitResponse,
  safeRateLimit,
  uploadHourlyRatelimit,
  uploadRatelimit,
} from "@/lib/ratelimit";
import {
  assertKnownContentLengthUnder,
  isInvalidContentLengthError,
  isMissingContentLengthError,
  isRequestBodyTooLargeError,
} from "@/lib/requestBody";
import {
  deletePrivateR2ObjectByKey,
  privateR2BucketName,
  r2,
} from "@/lib/r2";
import { requireStaffAdminPinForApi } from "@/lib/adminPinApi";
import { uploadKeyUserSegment } from "@/lib/uploadKey";
import {
  IMAGE_UPLOAD_TYPES,
  UPLOAD_MAX_SIZES,
  uploadTooLargeMessage,
  uploadTooManyFilesMessage,
  uploadTypeMessage,
} from "@/lib/uploadRules";
import { uploadTelemetryKeyHash } from "@/lib/uploadTelemetry";
import { uploadFileSignatureMatches } from "@/lib/uploadVerificationToken";
import { logServerError } from "@/lib/serverErrorLogger";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";

export const runtime = "nodejs";
export const maxDuration = 60;

const CASE_EVIDENCE_MULTIPART_BODY_MAX_BYTES = 10 * 1024 * 1024;
const CASE_EVIDENCE_LIMIT_INPUT_PIXELS = 50_000_000;

const FormSchema = z.object({
  fileIndex: z.coerce
    .number()
    .int()
    .min(0)
    .default(0),
});

function outputFor(contentType: string) {
  if (contentType === "image/png") {
    return { contentType: "image/png", ext: "png" };
  }
  if (contentType === "image/webp") {
    return { contentType: "image/webp", ext: "webp" };
  }
  return { contentType: "image/jpeg", ext: "jpg" };
}

async function stripMetadata(input: Buffer, contentType: string) {
  const image = sharp(input, {
    failOn: "error",
    limitInputPixels: CASE_EVIDENCE_LIMIT_INPUT_PIXELS,
  }).rotate();
  if (contentType === "image/png") {
    return image.png({ compressionLevel: 9 }).toBuffer();
  }
  if (contentType === "image/webp") {
    return image.webp({ quality: 88 }).toBuffer();
  }
  return image.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { userId, sessionId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (error) {
    const accountResponse = accountAccessErrorResponse(error);
    if (accountResponse) return accountResponse;
    throw error;
  }

  const { success, reset } = await safeRateLimit(uploadRatelimit, userId);
  if (!success) {
    return privateResponse(rateLimitResponse(reset, "Too many uploads."));
  }
  const { success: hourlySuccess, reset: hourlyReset } =
    await safeRateLimit(uploadHourlyRatelimit, userId);
  if (!hourlySuccess) {
    return privateResponse(
      rateLimitResponse(hourlyReset, "Too many uploads."),
    );
  }

  const caseRecord = await prisma.case.findUnique({
    where: { id },
    select: {
      buyerId: true,
      sellerId: true,
      status: true,
    },
  });
  if (!caseRecord) {
    return privateJson({ error: "Case not found." }, { status: 404 });
  }

  const isParty =
    me.id === caseRecord.buyerId || me.id === caseRecord.sellerId;
  const isStaff = me.role === "EMPLOYEE" || me.role === "ADMIN";
  const actsAsStaff = isStaff && !isParty;
  if (!isParty && !isStaff) {
    return privateJson({ error: "Forbidden." }, { status: 403 });
  }
  if (actsAsStaff) {
    const pinResponse = await requireStaffAdminPinForApi(req, userId, sessionId);
    if (pinResponse) return pinResponse;
  }
  if (!canCreateCaseMessageForStatus(caseRecord.status, { isStaff: actsAsStaff })) {
    return privateJson({ error: "This case is closed." }, { status: 400 });
  }

  let form: FormData;
  try {
    assertKnownContentLengthUnder(req, CASE_EVIDENCE_MULTIPART_BODY_MAX_BYTES);
    form = await req.formData();
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson(
        { error: "Request body too large" },
        { status: HTTP_STATUS.PAYLOAD_TOO_LARGE },
      );
    }
    if (isMissingContentLengthError(error)) {
      return privateJson(
        { error: "Content-Length header is required" },
        { status: HTTP_STATUS.LENGTH_REQUIRED },
      );
    }
    if (isInvalidContentLengthError(error)) {
      return privateJson(
        { error: "Invalid Content-Length header" },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    throw error;
  }

  const parsed = FormSchema.safeParse({
    fileIndex: form.get("fileIndex") ?? 0,
  });
  const file = form.get("file");
  if (!parsed.success || !(file instanceof File)) {
    return privateJson({ error: "Invalid upload" }, { status: 400 });
  }
  if (parsed.data.fileIndex >= MAX_CASE_MESSAGE_ATTACHMENTS) {
    return privateJson(
      { error: uploadTooManyFilesMessage(CASE_EVIDENCE_UPLOAD_ENDPOINT) },
      { status: 400 },
    );
  }
  if (
    !IMAGE_UPLOAD_TYPES.includes(
      file.type as (typeof IMAGE_UPLOAD_TYPES)[number],
    )
  ) {
    return privateJson(
      { error: uploadTypeMessage(CASE_EVIDENCE_UPLOAD_ENDPOINT, file.type) },
      { status: 400 },
    );
  }
  if (file.size > UPLOAD_MAX_SIZES.caseEvidenceImage) {
    return privateJson(
      { error: uploadTooLargeMessage(CASE_EVIDENCE_UPLOAD_ENDPOINT, file.size) },
      { status: 400 },
    );
  }

  let processed: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    if (!uploadFileSignatureMatches(input, file.type)) {
      return privateJson({ error: "Invalid image file" }, { status: 400 });
    }
    processed = await stripMetadata(input, file.type);
    if (processed.byteLength > UPLOAD_MAX_SIZES.caseEvidenceImage) {
      return privateJson(
        {
          error: uploadTooLargeMessage(
            CASE_EVIDENCE_UPLOAD_ENDPOINT,
            processed.byteLength,
          ),
        },
        { status: 400 },
      );
    }
  } catch {
    return privateJson({ error: "Image processing failed" }, { status: 400 });
  }

  const output = outputFor(file.type);
  const key = [
    CASE_EVIDENCE_UPLOAD_ENDPOINT,
    uploadKeyUserSegment(userId),
    id,
    `${Date.now()}-${randomUUID()}.${output.ext}`,
  ].join("/");

  try {
    await r2.send(
      new PutObjectCommand({
        Bucket: privateR2BucketName(),
        Key: key,
        Body: processed,
        ContentType: output.contentType,
        ContentLength: processed.byteLength,
        CacheControl: "private, no-store",
      }),
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "case_evidence_put_object" },
      extra: { contentType: output.contentType, size: processed.byteLength },
    });
    return privateJson(
      { error: "Case evidence could not be uploaded. Try again." },
      { status: HTTP_STATUS.BAD_GATEWAY },
    );
  }

  try {
    await recordDirectUploadVerified({
      key,
      endpoint: CASE_EVIDENCE_UPLOAD_ENDPOINT,
      userId: me.id,
      publicUrl: null,
      contentType: output.contentType,
      expectedSize: processed.byteLength,
      storageClass: CASE_EVIDENCE_STORAGE_CLASS,
    });
  } catch (error) {
    logServerError(error, {
      source: "case_evidence_lifecycle_record",
      level: "warning",
      extra: { keyHash: uploadTelemetryKeyHash(key) },
    });
    await deletePrivateR2ObjectByKey(key).catch((cleanupError) => {
      logServerError(cleanupError, {
        source: "case_evidence_lifecycle_cleanup",
        level: "warning",
        extra: { keyHash: uploadTelemetryKeyHash(key) },
      });
    });
    return privateJson(
      { error: "Case evidence could not be saved. Try again." },
      { status: HTTP_STATUS.BAD_GATEWAY },
    );
  }

  return privateJson({
    key,
    contentType: output.contentType,
    size: processed.byteLength,
  });
}
