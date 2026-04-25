// src/app/api/listings/[id]/notify/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { notifyRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { publicListingWhere } from "@/lib/listingVisibility";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: listingId } = await params;

  let user: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    user = await ensureUserByClerkId(clerkId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const { success: rlOk, reset } = await safeRateLimit(notifyRatelimit, user.id);
  if (!rlOk) return rateLimitResponse(reset, "Too many requests.");

  const listing = await prisma.listing.findFirst({
    where: publicListingWhere({ id: listingId }),
    select: { id: true, listingType: true, stockQuantity: true },
  });
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (listing.listingType !== "IN_STOCK" || (listing.stockQuantity ?? 0) > 0) {
    return NextResponse.json({ error: "Notifications are only available for out-of-stock items." }, { status: 400 });
  }

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

  let user: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    user = await ensureUserByClerkId(clerkId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const { success: rlOk, reset } = await safeRateLimit(notifyRatelimit, user.id);
  if (!rlOk) return rateLimitResponse(reset, "Too many requests.");

  await prisma.stockNotification.deleteMany({
    where: { listingId, userId: user.id },
  });

  return NextResponse.json({ subscribed: false });
}
