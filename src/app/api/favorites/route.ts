// src/app/api/favorites/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification } from "@/lib/notifications";
import { saveRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { publicListingDetailWhere } from "@/lib/listingVisibility";
import { publicListingPath } from "@/lib/publicPaths";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";

const FavoriteSchema = z.object({
  listingId: z.string().min(1),
});
const FAVORITE_BODY_MAX_BYTES = 8 * 1024;

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(saveRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "Too many save actions.");

  let listingId: string;
  try {
    const parsed = FavoriteSchema.parse(await readBoundedJson(req, FAVORITE_BODY_MAX_BYTES));
    listingId = parsed.listingId;
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(e)) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    throw e;
  }

  let me;
  try {
    me = await ensureUser();
  } catch (e) {
    const accountResponse = accountAccessErrorResponse(e);
    if (accountResponse) return accountResponse;

    console.error("POST /api/favorites ensureUser error:", { error: (e as Error).message, userId });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const listing = await prisma.listing.findFirst({
    where: publicListingDetailWhere({ id: listingId }),
    select: { title: true, seller: { select: { userId: true } } },
  });
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  if (listing.seller.userId === me.id) {
    return NextResponse.json({ error: "Cannot favorite your own listing." }, { status: 400 });
  }
  const blockExists = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: me.id, blockedId: listing.seller.userId },
        { blockerId: listing.seller.userId, blockedId: me.id },
      ],
    },
    select: { id: true },
  });
  if (blockExists) return NextResponse.json({ error: "Blocked" }, { status: 403 });

  try {
    await prisma.favorite.upsert({
      where: { userId_listingId: { userId: me.id, listingId } },
      update: {},
      create: { userId: me.id, listingId },
    });
  } catch (e) {
    console.error("POST /api/favorites upsert error:", {
      message: (e as Error).message,
      listingId,
      dbUserId: me.id,
    });
    Sentry.captureException(e, {
      tags: { source: "favorite_upsert" },
      extra: { listingId, dbUserId: me.id },
    });
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // Notify listing owner (non-fatal; createNotification handles exact duplicate suppression)
  try {
    const ownerUserId = listing.seller.userId;
    if (ownerUserId && ownerUserId !== me.id) {
      const favName = me.name ?? me.email?.split("@")[0] ?? "Someone";
      await createNotification({
        userId: ownerUserId,
        type: "NEW_FAVORITE",
        title: `${favName} hearted your listing`,
        body: listing.title,
        link: publicListingPath(listingId, listing.title),
        dedupScope: me.id,
      });
    }
  } catch (e) {
    console.error("POST /api/favorites notification error (non-fatal):", (e as Error).message);
    Sentry.captureException(e, {
      level: "warning",
      tags: { source: "favorite_notification" },
      extra: { listingId, dbUserId: me.id, sellerUserId: listing.seller.userId },
    });
  }

  return NextResponse.json({ ok: true });
}
