// src/app/api/listings/[id]/notify/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { notifyRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { publicListingDetailWhere } from "@/lib/listingVisibility";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { id: listingId } = await params;

  let user: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    user = await ensureUserByClerkId(clerkId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const { success: rlOk, reset } = await safeRateLimit(notifyRatelimit, user.id);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "Too many requests."));

  const listing = await prisma.listing.findFirst({
    where: publicListingDetailWhere({ id: listingId }),
    select: { id: true, listingType: true, stockQuantity: true },
  });
  if (!listing) return privateJson({ error: "Listing not found" }, { status: 404 });
  if (listing.listingType !== "IN_STOCK" || (listing.stockQuantity ?? 0) > 0) {
    return privateJson({ error: "Notifications are only available for out-of-stock items." }, { status: 400 });
  }

  await prisma.stockNotification.upsert({
    where: { listingId_userId: { listingId, userId: user.id } },
    create: { listingId, userId: user.id },
    update: {},
  });

  return privateJson({ subscribed: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { userId: clerkId } = await auth();
  if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { id: listingId } = await params;

  let user: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    user = await ensureUserByClerkId(clerkId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const { success: rlOk, reset } = await safeRateLimit(notifyRatelimit, user.id);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "Too many requests."));

  await prisma.stockNotification.deleteMany({
    where: { listingId, userId: user.id },
  });

  return privateJson({ subscribed: false });
}
