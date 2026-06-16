import { randomUUID } from "crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import sharp from "sharp";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { prisma } from "@/lib/db";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
import { assertPublicMediaAvailable } from "@/lib/publicMediaAvailability";
import { rateLimitResponse, safeRateLimit, uploadHourlyRatelimit, uploadRatelimit } from "@/lib/ratelimit";
import { uploadServiceFailure } from "@/lib/uploadServiceFailure";
import { uploadKeyUserSegment } from "@/lib/uploadKey";
import { uploadFileSignatureMatches } from "@/lib/uploadVerificationToken";
import { assertContentLengthUnder, isRequestBodyTooLargeError } from "@/lib/requestBody";
import {
  IMAGE_UPLOAD_ENDPOINTS,
  IMAGE_UPLOAD_TYPES,
  UPLOAD_MAX_COUNTS,
  UPLOAD_MAX_SIZES,
  type UploadEndpoint,
  uploadTooLargeMessage,
  uploadTooManyFilesMessage,
  uploadTypeMessage,
} from "@/lib/uploadRules";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { uploadTelemetryKeyHash } from "@/lib/uploadTelemetry";
import { logServerError } from "@/lib/serverErrorLogger";

export const runtime = "nodejs";
export const maxDuration = 60;

const SELLER_ONLY_ENDPOINTS = new Set(["listingImage", "bannerImage", "galleryImage"]);
const BLOG_AUTHOR_ENDPOINTS = new Set(["blogImage"]);
const IMAGE_UPLOAD_MULTIPART_BODY_MAX_BYTES = 16 * 1024 * 1024;
const IMAGE_UPLOAD_LIMIT_INPUT_PIXELS = 50_000_000;

const FormSchema = z.object({
  endpoint: z.enum(IMAGE_UPLOAD_ENDPOINTS),
  fileIndex: z.coerce.number().int().min(0).default(0),
});

function outputFor(contentType: string) {
  if (contentType === "image/png") return { contentType: "image/png", ext: "png" };
  if (contentType === "image/webp") return { contentType: "image/webp", ext: "webp" };
  return { contentType: "image/jpeg", ext: "jpg" };
}

async function stripMetadata(input: Buffer, contentType: string) {
  const image = sharp(input, { failOn: "error", limitInputPixels: IMAGE_UPLOAD_LIMIT_INPUT_PIXELS }).rotate();
  if (contentType === "image/png") return image.png({ compressionLevel: 9 }).toBuffer();
  if (contentType === "image/webp") return image.webp({ quality: 88 }).toBuffer();
  return image.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

async function deleteUploadedImageObject(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });
  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const { success, reset } = await safeRateLimit(uploadRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many uploads."));
  const { success: hourlySuccess, reset: hourlyReset } = await safeRateLimit(uploadHourlyRatelimit, userId);
  if (!hourlySuccess) return privateResponse(rateLimitResponse(hourlyReset, "Too many uploads."));

  let form: FormData;
  try {
    assertContentLengthUnder(req, IMAGE_UPLOAD_MULTIPART_BODY_MAX_BYTES);
    form = await req.formData();
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: 413 });
    }
    throw error;
  }
  const parsed = FormSchema.safeParse({
    endpoint: form.get("endpoint"),
    fileIndex: form.get("fileIndex") ?? 0,
  });
  const file = form.get("file");

  if (!parsed.success || !(file instanceof File)) {
    return privateJson({ error: "Invalid upload" }, { status: 400 });
  }

  const { endpoint, fileIndex } = parsed.data;
  const uploadEndpoint = endpoint as UploadEndpoint;
  if (SELLER_ONLY_ENDPOINTS.has(endpoint)) {
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true },
    });
    if (!seller) return privateJson({ error: "Seller profile required" }, { status: 403 });
  }
  if (BLOG_AUTHOR_ENDPOINTS.has(endpoint)) {
    const isStaff = me.role === "EMPLOYEE" || me.role === "ADMIN";
    if (!isStaff) {
      const seller = await prisma.sellerProfile.findUnique({
        where: { userId: me.id },
        select: { id: true },
      });
      if (!seller) return privateJson({ error: "Seller profile required" }, { status: 403 });
    }
  }
  if (fileIndex >= UPLOAD_MAX_COUNTS[uploadEndpoint]) {
    return privateJson({ error: uploadTooManyFilesMessage(uploadEndpoint) }, { status: 400 });
  }
  if (!IMAGE_UPLOAD_TYPES.includes(file.type as (typeof IMAGE_UPLOAD_TYPES)[number])) {
    return privateJson({ error: uploadTypeMessage(uploadEndpoint, file.type) }, { status: 400 });
  }
  if (file.size > UPLOAD_MAX_SIZES[uploadEndpoint]) {
    return privateJson({ error: uploadTooLargeMessage(uploadEndpoint, file.size) }, { status: 400 });
  }

  let processed: Buffer;
  try {
    const input = Buffer.from(await file.arrayBuffer());
    if (!uploadFileSignatureMatches(input, file.type)) {
      return privateJson({ error: "Invalid image file" }, { status: 400 });
    }
    processed = await stripMetadata(input, file.type);
    if (processed.byteLength > UPLOAD_MAX_SIZES[uploadEndpoint]) {
      return privateJson(
        { error: uploadTooLargeMessage(uploadEndpoint, processed.byteLength) },
        { status: 400 },
      );
    }
  } catch {
    return privateJson({ error: "Image processing failed" }, { status: 400 });
  }

  const output = outputFor(file.type);
  const key = `${endpoint}/${uploadKeyUserSegment(userId)}/${Date.now()}-${randomUUID()}.${output.ext}`;

  try {
    await r2.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: processed,
      ContentType: output.contentType,
      ContentLength: processed.byteLength,
      CacheControl: "public, max-age=31536000, immutable",
    }));
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "upload_image_put_object", endpoint },
      extra: { contentType: output.contentType, size: processed.byteLength },
    });
    const failure = uploadServiceFailure("object-write");
    return privateJson(failure.body, failure.init);
  }

  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  try {
    await assertPublicMediaAvailable(publicUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Uploaded media is not publicly available.";
    await deleteUploadedImageObject(key).catch((deleteError) => {
      logServerError(deleteError, {
        source: "upload_image_cleanup",
        level: "warning",
        tags: { endpoint },
        extra: { keyHash: uploadTelemetryKeyHash(key) },
      });
    });
    return privateJson({ error: message }, { status: 502 });
  }

  return privateJson({
    publicUrl,
    key,
    contentType: output.contentType,
    size: processed.byteLength,
  });
}
