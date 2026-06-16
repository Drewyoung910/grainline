import { HeadObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { R2_BUCKET, r2 } from "@/lib/r2";
import { rateLimitResponse, safeRateLimit, uploadHourlyRatelimit } from "@/lib/ratelimit";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import {
  uploadVerificationExpiresAtIsTooFarFuture,
  uploadedObjectVerificationError,
  uploadFileSignatureMatches,
  uploadKeyBelongsToUser,
  verifyUploadVerificationToken,
} from "@/lib/uploadVerificationToken";
import { DIRECT_UPLOAD_ENDPOINTS, UPLOAD_MAX_SIZES } from "@/lib/uploadRules";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { uploadTelemetryKeyHash } from "@/lib/uploadTelemetry";
import { logServerError } from "@/lib/serverErrorLogger";

export const maxDuration = 60;

const Schema = z.object({
  key: z.string().min(1).max(500),
  endpoint: z.enum(DIRECT_UPLOAD_ENDPOINTS),
  expectedSize: z.number().int().positive(),
  contentType: z.string().min(1).max(100),
  verificationToken: z.string().min(1).max(200),
  verificationExpiresAt: z.number().int().positive().refine(
    (expiresAt) => !uploadVerificationExpiresAtIsTooFarFuture(expiresAt),
    "Upload verification expiry is too far in the future.",
  ),
});
const UPLOAD_VERIFY_BODY_MAX_BYTES = 16 * 1024;

async function deleteObject(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

async function objectPrefixBytes(key: string) {
  const response = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key, Range: "bytes=0-511" }));
  const body = response.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!body?.transformToByteArray) return new Uint8Array();
  return body.transformToByteArray();
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const { success, reset } = await safeRateLimit(uploadHourlyRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many uploads."));

  let body: unknown;
  try {
    body = await readBoundedJson(req, UPLOAD_VERIFY_BODY_MAX_BYTES);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(error)) {
      return privateJson({ error: "Invalid input" }, { status: 400 });
    }
    throw error;
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return privateJson({ error: "Invalid input" }, { status: 400 });
  }

  const { key, endpoint, expectedSize, contentType, verificationToken, verificationExpiresAt } = parsed.data;
  if (!uploadKeyBelongsToUser(key, endpoint, userId)) {
    return privateJson({ error: "Upload key mismatch" }, { status: 403 });
  }

  const tokenValid = verifyUploadVerificationToken({
    key,
    endpoint,
    expectedSize,
    contentType,
    expiresAt: verificationExpiresAt,
  }, verificationToken);
  if (!tokenValid) {
    return privateJson({ error: "Upload verification token is invalid or expired" }, { status: 403 });
  }

  let head;
  try {
    head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch {
    return privateJson({ error: "Uploaded object was not found" }, { status: 404 });
  }

  const actualSize = head.ContentLength ?? 0;
  const maxSize = UPLOAD_MAX_SIZES[endpoint];
  const verificationError = uploadedObjectVerificationError({
    actualSize,
    expectedSize,
    maxSize,
    actualContentType: head.ContentType,
    expectedContentType: contentType,
  });
  if (verificationError) {
    await deleteObject(key).catch((error) => {
      logServerError(error, {
        source: "upload_verify_cleanup",
        level: "warning",
        tags: { endpoint },
        extra: { keyHash: uploadTelemetryKeyHash(key) },
      });
    });
    return privateJson({ error: verificationError }, { status: 400 });
  }

  let prefixBytes: Uint8Array;
  try {
    prefixBytes = await objectPrefixBytes(key);
  } catch (error) {
    await deleteObject(key).catch((cleanupError) => {
      logServerError(cleanupError, {
        source: "upload_verify_cleanup",
        level: "warning",
        tags: { endpoint },
        extra: { keyHash: uploadTelemetryKeyHash(key) },
      });
    });
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "upload_verify_read_signature", endpoint },
      extra: { keyHash: uploadTelemetryKeyHash(key) },
    });
    return privateJson({ error: "Uploaded object could not be verified" }, { status: 400 });
  }

  if (!uploadFileSignatureMatches(prefixBytes, contentType)) {
    await deleteObject(key).catch((error) => {
      logServerError(error, {
        source: "upload_verify_cleanup",
        level: "warning",
        tags: { endpoint },
        extra: { keyHash: uploadTelemetryKeyHash(key) },
      });
    });
    return privateJson({ error: "Uploaded file content did not match the signed file type." }, { status: 400 });
  }

  return privateJson({ ok: true, size: actualSize });
}
