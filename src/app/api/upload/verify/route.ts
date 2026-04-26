import { HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { R2_BUCKET, r2 } from "@/lib/r2";
import { rateLimitResponse, safeRateLimit, uploadHourlyRatelimit } from "@/lib/ratelimit";

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
});

function keyBelongsToUser(key: string, endpoint: string, clerkUserId: string) {
  return key.startsWith(`${endpoint}/${clerkUserId}/`) && !key.includes("..");
}

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

  const { key, endpoint, expectedSize } = parsed.data;
  if (!keyBelongsToUser(key, endpoint, userId)) {
    return NextResponse.json({ error: "Upload key mismatch" }, { status: 403 });
  }

  let head;
  try {
    head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch {
    return NextResponse.json({ error: "Uploaded object was not found" }, { status: 404 });
  }

  const actualSize = head.ContentLength ?? 0;
  const maxSize = MAX_SIZES[endpoint];
  if (actualSize <= 0 || actualSize > expectedSize || actualSize > maxSize) {
    await deleteObject(key).catch((error) => {
      console.error("[upload verify] failed to delete oversized object:", error);
    });
    return NextResponse.json({ error: "Uploaded file size did not match the signed upload." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, size: actualSize });
}
