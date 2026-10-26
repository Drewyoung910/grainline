// src/app/api/listings/[id]/notify/route.ts
import { auth } from "@clerk/nextjs/server";
import { notifyRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import {
  deleteOwnerStockNotification,
  subscribeOwnerStockNotification,
} from "@/lib/stockNotificationAccess";

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

  const result = await subscribeOwnerStockNotification(user.id, listingId);
  if (result.resultStatus === "SELF") {
    return privateJson({ error: "You cannot subscribe to your own listing." }, { status: 400 });
  }
  if (result.resultStatus === "BLOCKED") {
    return privateJson({ error: "This listing is unavailable." }, { status: 404 });
  }
  if (result.resultStatus === "UNAVAILABLE") {
    return privateJson({ error: "Notifications are only available for out-of-stock items." }, { status: 400 });
  }
  return privateJson({ subscribed: result.subscribed });
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

  await deleteOwnerStockNotification(user.id, listingId);

  return privateJson({ subscribed: false });
}
