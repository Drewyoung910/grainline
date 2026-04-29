import { HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { R2_BUCKET, r2 } from "@/lib/r2";
import { rateLimitResponse, safeRateLimit, uploadHourlyRatelimit } from "@/lib/ratelimit";
import {
  uploadedObjectVerificationError,
  uploadKeyBelongsToUser,
  verifyUploadVerificationToken,
} from "@/lib/uploadVerificationToken";

const MAX_SIZES: Record<string, number> = {
  listingVideo: 128 * 1024 * 1024,
  messageFile: 8 * 1024 * 1024,
  messageAny: 8 * 1024 * 1024,
};

const ENDPOINTS = Object.keys(MAX_SIZES) as [keyof typeof MAX_SIZES, ...Array<keyof typeof MAX_SIZES>];

const Schema = z.object({
  key: z.string().min(1).max(500),
  endpoint: z.enum(ENDPOINTS),
  expectedSize: z.number().int().positive(),
  contentType: z.string().min(1).max(100),
  verificationToken: z.string().min(1).max(200),
  verificationExpiresAt: z.number().int().positive(),
});

async function deleteObject(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const { success, reset } = await safeRateLimit(uploadHourlyRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many uploads.");

  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { key, endpoint, expectedSize, contentType, verificationToken, verificationExpiresAt } = parsed.data;
  if (!uploadKeyBelongsToUser(key, endpoint, userId)) {
    return NextResponse.json({ error: "Upload key mismatch" }, { status: 403 });
  }

  const tokenValid = verifyUploadVerificationToken({
    key,
    endpoint,
    expectedSize,
    contentType,
    expiresAt: verificationExpiresAt,
  }, verificationToken);
  if (!tokenValid) {
    return NextResponse.json({ error: "Upload verification token is invalid or expired" }, { status: 403 });
  }

  let head;
  try {
    head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch {
    return NextResponse.json({ error: "Uploaded object was not found" }, { status: 404 });
  }

  const actualSize = head.ContentLength ?? 0;
  const maxSize = MAX_SIZES[endpoint];
  const verificationError = uploadedObjectVerificationError({
    actualSize,
    expectedSize,
    maxSize,
    actualContentType: head.ContentType,
    expectedContentType: contentType,
  });
  if (verificationError) {
    await deleteObject(key).catch((error) => {
      console.error("[upload verify] failed to delete invalid object:", error);
    });
    return NextResponse.json({ error: verificationError }, { status: 400 });
  }

  return NextResponse.json({ ok: true, size: actualSize });
}
