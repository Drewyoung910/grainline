// src/app/api/seller/broadcast/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { broadcastRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { sanitizeText } from "@/lib/sanitize";
import { z } from "zod";

const BroadcastSchema = z.object({
  message: z.string().min(1).max(500),
  imageUrl: z.string().min(1).optional().nullable(),
  sellersOnly: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true, displayName: true },
  });
  if (!seller) return NextResponse.json({ error: "No seller profile" }, { status: 403 });

  const { success: rlOk, reset } = await safeRateLimit(broadcastRatelimit, seller.id);
  if (!rlOk) return rateLimitResponse(reset, "You can send one broadcast per week.");

  let broadcastParsed;
  try {
    broadcastParsed = BroadcastSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const message = sanitizeText(broadcastParsed.message.trim().slice(0, 500));
  const imageUrl = broadcastParsed.imageUrl?.trim() || null;
  const sellersOnly = broadcastParsed.sellersOnly === true;

  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });

  // Enforce 7-day rate limit between broadcasts
  const lastBroadcast = await prisma.sellerBroadcast.findFirst({
    where: { sellerProfileId: seller.id },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (lastBroadcast) {
    const daysSinceLast = (Date.now() - lastBroadcast.sentAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast < 7) {
      const nextAvailable = new Date(lastBroadcast.sentAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      return NextResponse.json(
        { error: `You can send one broadcast per week. Next available: ${nextAvailable.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` },
        { status: 429 }
      );
    }
  }

  // Get followers (optionally filtered to sellers only)
  const followers = await prisma.follow.findMany({
    where: {
      sellerProfileId: seller.id,
      ...(sellersOnly ? { follower: { sellerProfile: { isNot: null } } } : {}),
    },
    select: { followerId: true },
  });

  // Create broadcast record
  const broadcast = await prisma.sellerBroadcast.create({
    data: {
      sellerProfileId: seller.id,
      message,
      imageUrl,
      recipientCount: followers.length,
    },
  });

  // Send notifications (fire-and-forget for large follower counts)
  void (async () => {
    try {
      const sellerName = seller.displayName ?? "A maker you follow";
      await Promise.all(
        followers.map((f) =>
          createNotification({
            userId: f.followerId,
            type: "SELLER_BROADCAST",
            title: `Update from ${sellerName}`,
            body: message.slice(0, 100) + (message.length > 100 ? "…" : ""),
            link: `/account/feed`,
          })
        )
      );
    } catch { /* non-fatal */ }
  })();

  return NextResponse.json({ broadcastId: broadcast.id, recipientCount: followers.length });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true },
  });
  if (!seller) return NextResponse.json({ error: "No seller profile" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = 10;

  const [broadcasts, total] = await Promise.all([
    prisma.sellerBroadcast.findMany({
      where: { sellerProfileId: seller.id },
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, message: true, imageUrl: true, sentAt: true, recipientCount: true },
    }),
    prisma.sellerBroadcast.count({ where: { sellerProfileId: seller.id } }),
  ]);

  return NextResponse.json({ broadcasts, total, page, pageSize });
}
