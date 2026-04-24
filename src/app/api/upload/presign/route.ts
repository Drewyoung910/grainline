import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "@/lib/r2";
import { z } from "zod";

const ALLOWED_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/quicktime",
  "application/pdf",
];

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

  // Rate limit: 30 uploads per 10 minutes per user
  const { safeRateLimit } = await import("@/lib/ratelimit");
  const { Ratelimit } = await import("@upstash/ratelimit");
  const { Redis } = await import("@upstash/redis");
  const uploadRl = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(30, "10 m"),
    prefix: "rl:upload",
  });
  const { success: rlOk } = await safeRateLimit(uploadRl, userId);
  if (!rlOk) return NextResponse.json({ error: "Too many uploads. Try again later." }, { status: 429 });

  let body;
  try {
    body = Schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { filename, contentType, size, endpoint, fileIndex } = body;

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
