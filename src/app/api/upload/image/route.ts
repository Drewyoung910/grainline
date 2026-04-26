import { randomUUID } from "crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { prisma } from "@/lib/db";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
import { assertPublicMediaAvailable } from "@/lib/publicMediaAvailability";
import { rateLimitResponse, safeRateLimit, uploadHourlyRatelimit, uploadRatelimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const IMAGE_ENDPOINTS = [
  "listingImage",
  "messageImage",
  "messageAny",
  "reviewPhoto",
  "bannerImage",
  "galleryImage",
] as const;

const MAX_SIZES: Record<(typeof IMAGE_ENDPOINTS)[number], number> = {
  listingImage: 8 * 1024 * 1024,
  messageImage: 8 * 1024 * 1024,
  messageAny: 8 * 1024 * 1024,
  reviewPhoto: 8 * 1024 * 1024,
  bannerImage: 4 * 1024 * 1024,
  galleryImage: 4 * 1024 * 1024,
};

const MAX_COUNTS: Record<(typeof IMAGE_ENDPOINTS)[number], number> = {
  listingImage: 8,
  messageImage: 6,
  messageAny: 6,
  reviewPhoto: 6,
  bannerImage: 1,
  galleryImage: 10,
};

const SELLER_ONLY_ENDPOINTS = new Set(["listingImage", "bannerImage", "galleryImage"]);

const FormSchema = z.object({
  endpoint: z.enum(IMAGE_ENDPOINTS),
  fileIndex: z.coerce.number().int().min(0).default(0),
});

function outputFor(contentType: string) {
  if (contentType === "image/png") return { contentType: "image/png", ext: "png" };
  if (contentType === "image/webp") return { contentType: "image/webp", ext: "webp" };
  return { contentType: "image/jpeg", ext: "jpg" };
}

async function stripMetadata(input: Buffer, contentType: string) {
  const image = sharp(input, { failOn: "error" }).rotate();
  if (contentType === "image/png") return image.png({ compressionLevel: 9 }).toBuffer();
  if (contentType === "image/webp") return image.webp({ quality: 88 }).toBuffer();
  return image.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

export async function POST(req: Request) {
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

  const { success, reset } = await safeRateLimit(uploadRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many uploads.");
  const { success: hourlySuccess, reset: hourlyReset } = await safeRateLimit(uploadHourlyRatelimit, userId);
  if (!hourlySuccess) return rateLimitResponse(hourlyReset, "Too many uploads.");

  const form = await req.formData();
  const parsed = FormSchema.safeParse({
    endpoint: form.get("endpoint"),
    fileIndex: form.get("fileIndex") ?? 0,
  });
  const file = form.get("file");

  if (!parsed.success || !(file instanceof File)) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }

  const { endpoint, fileIndex } = parsed.data;
  if (SELLER_ONLY_ENDPOINTS.has(endpoint)) {
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true },
    });
    if (!seller) return NextResponse.json({ error: "Seller profile required" }, { status: 403 });
  }
  if (fileIndex >= MAX_COUNTS[endpoint]) {
    return NextResponse.json({ error: "Too many files" }, { status: 400 });
  }
  if (!IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number])) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }
  if (file.size > MAX_SIZES[endpoint]) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  let processed: Buffer;
  try {
    processed = await stripMetadata(Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    return NextResponse.json({ error: "Image processing failed" }, { status: 400 });
  }

  const output = outputFor(file.type);
  const key = `${endpoint}/${userId}/${Date.now()}-${randomUUID()}.${output.ext}`;

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: processed,
    ContentType: output.contentType,
    ContentLength: processed.byteLength,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  try {
    await assertPublicMediaAvailable(publicUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Uploaded media is not publicly available.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json({
    publicUrl,
    key,
    contentType: output.contentType,
    size: processed.byteLength,
  });
}
