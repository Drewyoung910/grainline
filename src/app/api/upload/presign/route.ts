import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { randomBytes } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { prisma } from "@/lib/db";
import { rateLimitResponse, safeRateLimit, uploadHourlyRatelimit, uploadRatelimit } from "@/lib/ratelimit";
import { uploadServiceFailure } from "@/lib/uploadServiceFailure";
import { createUploadVerificationToken } from "@/lib/uploadVerificationToken";
import { uploadKeyUserSegment } from "@/lib/uploadKey";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import {
  DIRECT_ENDPOINT_ALLOWED_TYPES,
  IMAGE_UPLOAD_TYPES,
  UPLOAD_ENDPOINTS,
  UPLOAD_MAX_COUNTS,
  UPLOAD_MAX_SIZES,
  type UploadEndpoint,
  uploadExtensionMessage,
  uploadTooLargeMessage,
  uploadTooManyFilesMessage,
  uploadTypeMessage,
} from "@/lib/uploadRules";

const ALLOWED_TYPES = [
  "video/mp4", "video/quicktime",
  "application/pdf",
];

const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  "video/mp4": ["mp4"],
  "video/quicktime": ["mov", "qt"],
  "application/pdf": ["pdf"],
};

const SELLER_ONLY_ENDPOINTS = new Set(["listingImage", "listingVideo", "bannerImage", "galleryImage"]);

const Schema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive(),
  endpoint: z.enum(UPLOAD_ENDPOINTS),
  fileIndex: z.number().int().min(0).default(0),
});
const UPLOAD_PRESIGN_BODY_MAX_BYTES = 16 * 1024;

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const { success: rlOk, reset } = await safeRateLimit(uploadRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many uploads.");
  const { success: hourlyOk, reset: hourlyReset } = await safeRateLimit(uploadHourlyRatelimit, userId);
  if (!hourlyOk) return rateLimitResponse(hourlyReset, "Too many uploads.");

  let body;
  try {
    body = Schema.parse(await readBoundedJson(req, UPLOAD_PRESIGN_BODY_MAX_BYTES));
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(e)) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    throw e;
  }

  const { filename, contentType, size, endpoint, fileIndex } = body;
  const uploadEndpoint = endpoint as UploadEndpoint;
  if (SELLER_ONLY_ENDPOINTS.has(endpoint)) {
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true },
    });
    if (!seller) return NextResponse.json({ error: "Seller profile required" }, { status: 403 });
  }

  if (IMAGE_UPLOAD_TYPES.includes(contentType as (typeof IMAGE_UPLOAD_TYPES)[number])) {
    return NextResponse.json(
      { error: "Image uploads must use the processed upload endpoint." },
      { status: 400 }
    );
  }

  if (!DIRECT_ENDPOINT_ALLOWED_TYPES[uploadEndpoint]?.includes(contentType)) {
    return NextResponse.json({ error: uploadTypeMessage(uploadEndpoint, contentType) }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: uploadTypeMessage(uploadEndpoint, contentType) }, { status: 400 });
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const allowedExtensions = ALLOWED_EXTENSIONS[contentType] ?? [];
  if (!allowedExtensions.includes(ext)) {
    return NextResponse.json({ error: uploadExtensionMessage(contentType, allowedExtensions) }, { status: 400 });
  }

  if (size > UPLOAD_MAX_SIZES[uploadEndpoint]) {
    return NextResponse.json({ error: uploadTooLargeMessage(uploadEndpoint, size) }, { status: 400 });
  }

  if (fileIndex >= UPLOAD_MAX_COUNTS[uploadEndpoint]) {
    return NextResponse.json({ error: uploadTooManyFilesMessage(uploadEndpoint) }, { status: 400 });
  }

  const key = `${endpoint}/${uploadKeyUserSegment(userId)}/${Date.now()}-${randomBytes(12).toString("hex")}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
    // Keys include timestamp+random — content is immutable once uploaded.
    // Long cache + immutable prevents re-fetches from R2 origin.
    CacheControl: "public, max-age=31536000, immutable",
  });

  let presignedUrl: string;
  try {
    presignedUrl = await getSignedUrl(r2, command, { expiresIn: 300 });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "upload_presign_get_signed_url", endpoint },
      extra: { contentType, size },
    });
    const failure = uploadServiceFailure("presign");
    return NextResponse.json(failure.body, failure.init);
  }
  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  const verification = createUploadVerificationToken({
    key,
    endpoint,
    expectedSize: size,
    contentType,
  });
  if (!verification) {
    return NextResponse.json({ error: "Upload verification is not configured" }, { status: 500 });
  }

  return NextResponse.json({
    presignedUrl,
    publicUrl,
    key,
    contentType,
    expectedSize: size,
    verificationToken: verification.token,
    verificationExpiresAt: verification.expiresAt,
  });
}
