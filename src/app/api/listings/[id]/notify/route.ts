// src/app/api/listings/[id]/notify/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { notifyRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: listingId } = await params;

  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { success: rlOk, reset } = await safeRateLimit(notifyRatelimit, user.id);
  if (!rlOk) return rateLimitResponse(reset, "Too many requests.");

  await prisma.stockNotification.upsert({
    where: { listingId_userId: { listingId, userId: user.id } },
    create: { listingId, userId: user.id },
    update: {},
  });

  return NextResponse.json({ subscribed: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: listingId } = await params;

  const user = await prisma.user.findUnique({ where: { clerkId }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { success: rlOk, reset } = await safeRateLimit(notifyRatelimit, user.id);
  if (!rlOk) return rateLimitResponse(reset, "Too many requests.");

  await prisma.stockNotification.deleteMany({
    where: { listingId, userId: user.id },
  });

  return NextResponse.json({ subscribed: false });
}
