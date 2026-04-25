import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
import { z } from "zod";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { rateLimitResponse, safeRateLimit, uploadRatelimit } from "@/lib/ratelimit";

const ALLOWED_TYPES = [
  "image/gif",
  "video/mp4", "video/quicktime",
  "application/pdf",
];

const PROCESSED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const SELLER_ONLY_ENDPOINTS = new Set(["listingImage", "listingVideo", "bannerImage", "galleryImage"]);

const MAX_SIZES: Record<string, number> = {
  listingImage: 8 * 1024 * 1024,
  messageImage: 8 * 1024 * 1024,
  messageFile: 8 * 1024 * 1024,
  messageAny: 8 * 1024 * 1024,
  reviewPhoto: 8 * 1024 * 1024,
  listingVideo: 128 * 1024 * 1024,
  bannerImage: 4 * 1024 * 1024,
  galleryImage: 4 * 1024 * 1024,
};

const MAX_COUNTS: Record<string, number> = {
  listingImage: 8,
  messageImage: 6,
  messageFile: 4,
  messageAny: 6,
  reviewPhoto: 6,
  listingVideo: 1,
  bannerImage: 1,
  galleryImage: 10,
};

const Schema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(100),
  size: z.number().int().positive(),
  endpoint: z.enum([
    "listingImage", "messageImage", "messageFile", "messageAny",
    "reviewPhoto", "listingVideo", "bannerImage", "galleryImage",
  ]),
  fileIndex: z.number().int().min(0).default(0),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = await ensureUserByClerkId(userId);

  const { success: rlOk, reset } = await safeRateLimit(uploadRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many uploads.");

  let body;
  try {
    body = Schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { filename, contentType, size, endpoint, fileIndex } = body;
  if (SELLER_ONLY_ENDPOINTS.has(endpoint)) {
    const seller = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true },
    });
    if (!seller) return NextResponse.json({ error: "Seller profile required" }, { status: 403 });
  }

  if (PROCESSED_IMAGE_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: "Image uploads must use the processed upload endpoint." },
      { status: 400 }
    );
  }

  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  if (size > MAX_SIZES[endpoint]) {
    return NextResponse.json({ error: "File too large" }, { status: 400 });
  }

  if (fileIndex >= MAX_COUNTS[endpoint]) {
    return NextResponse.json({ error: "Too many files" }, { status: 400 });
  }

  const ext = filename.split(".").pop() ?? "bin";
  const key = `${endpoint}/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
    // Keys include timestamp+random — content is immutable once uploaded.
    // Long cache + immutable prevents re-fetches from R2 origin.
    CacheControl: "public, max-age=31536000, immutable",
  });

  const presignedUrl = await getSignedUrl(r2, command, { expiresIn: 300 });
  const publicUrl = `${R2_PUBLIC_URL}/${key}`;

  return NextResponse.json({ presignedUrl, publicUrl, key });
}
