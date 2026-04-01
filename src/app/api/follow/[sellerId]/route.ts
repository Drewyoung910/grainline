// src/app/api/follow/[sellerId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { ensureUser } from "@/lib/ensureUser";
import { followRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { logSecurityEvent } from "@/lib/security";

async function getFollowerCount(sellerProfileId: string) {
  return prisma.follow.count({ where: { sellerProfileId } });
}

// GET — check if current user follows this seller
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> }
) {
  const { sellerId } = await params;

  // sellerId here is the SellerProfile.id (not userId)
  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { id: true },
  });
  if (!sellerProfile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const followerCount = await getFollowerCount(sellerProfile.id);

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ following: false, followerCount });
  }

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return NextResponse.json({ following: false, followerCount });

  const existing = await prisma.follow.findUnique({
    where: { followerId_sellerProfileId: { followerId: me.id, sellerProfileId: sellerProfile.id } },
    select: { id: true },
  });

  return NextResponse.json({ following: !!existing, followerCount });
}

// POST — follow
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> }
) {
  const { sellerId } = await params;

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(followRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many follow actions.");

  const me = await ensureUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { id: true, userId: true, displayName: true },
  });
  if (!sellerProfile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Cannot follow yourself
  if (sellerProfile.userId === me.id) {
    logSecurityEvent("spam_attempt", { userId: me.id, route: "/api/follow", reason: "self-follow attempt" });
    return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
  }

  await prisma.follow.upsert({
    where: { followerId_sellerProfileId: { followerId: me.id, sellerProfileId: sellerProfile.id } },
    create: { followerId: me.id, sellerProfileId: sellerProfile.id },
    update: {},
  });

  const followerCount = await getFollowerCount(sellerProfile.id);

  // Notify the seller
  const followerName = me.name ?? me.email.split("@")[0] ?? "Someone";
  await createNotification({
    userId: sellerProfile.userId,
    type: "NEW_FOLLOWER",
    title: `${followerName} started following you`,
    body: "They can now see your new listings and posts in their feed",
    link: "/dashboard/analytics",
  });

  return NextResponse.json({ following: true, followerCount });
}

// DELETE — unfollow
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ sellerId: string }> }
) {
  const { sellerId } = await params;

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(followRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many follow actions.");

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sellerProfile = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: { id: true },
  });
  if (!sellerProfile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.follow.deleteMany({
    where: { followerId: me.id, sellerProfileId: sellerProfile.id },
  });

  const followerCount = await getFollowerCount(sellerProfile.id);

  return NextResponse.json({ following: false, followerCount });
}
