// src/app/api/listings/[id]/stock/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { renderBackInStockEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { listingMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { chunkArray, mapWithConcurrency } from "@/lib/concurrency";
import { publicListingPath } from "@/lib/publicPaths";
import {
  LOW_STOCK_DEDUP_WINDOW_MS,
  MAX_MANUAL_STOCK_QUANTITY,
  lowStockNotificationLink,
  normalizeManualStockQuantity,
  stockAlertBody,
} from "@/lib/stockMutationState";
import { revalidateListingSearchCaches } from "@/lib/searchCache";
import { syncGuildMemberListingThreshold } from "@/lib/guildListingThreshold";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";

const StockPatchSchema = z.object({
  quantity: z.number().int().min(0).max(MAX_MANUAL_STOCK_QUANTITY),
  expectedQuantity: z.number().int().min(0).max(MAX_MANUAL_STOCK_QUANTITY).optional().nullable(),
});

export const runtime = "nodejs";
const BACK_IN_STOCK_CLAIM_BATCH_SIZE = 5000;
const BACK_IN_STOCK_USER_LOOKUP_BATCH_SIZE = 500;
const LISTING_STOCK_BODY_MAX_BYTES = 8 * 1024;

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { success, reset } = await safeRateLimit(listingMutationRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many listing updates.");
    const me = await ensureUserByClerkId(userId);

    let stockParsed;
    try {
      stockParsed = StockPatchSchema.parse(await readBoundedJson(req, LISTING_STOCK_BODY_MAX_BYTES));
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
    const quantity = normalizeManualStockQuantity(stockParsed.quantity);
    const expectedQuantity = stockParsed.expectedQuantity == null
      ? null
      : normalizeManualStockQuantity(stockParsed.expectedQuantity);

    // Ownership check
    const listing = await prisma.listing.findFirst({
      where: { id, seller: { userId: me.id } },
      select: {
        id: true,
        listingType: true,
        status: true,
        stockQuantity: true,
        isPrivate: true,
        seller: { select: { id: true, userId: true } },
      },
    });
    if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (listing.listingType !== "IN_STOCK") {
      return NextResponse.json({ error: "Only IN_STOCK listings have quantity" }, { status: 400 });
    }

    const applyDelta = expectedQuantity != null;
    const stockDelta = applyDelta ? quantity - expectedQuantity : 0;

    // NOTE: restocking always promotes SOLD_OUT -> ACTIVE. If listing was
    // previously HIDDEN before going SOLD_OUT, seller must re-hide manually.
    // Tracking pre-SOLD_OUT status would require a schema change.
    const updatedRows = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      stockQuantity: number | null;
      status: string;
    }>>`
      UPDATE "Listing"
      SET
        "stockQuantity" = CASE
          WHEN ${applyDelta} THEN GREATEST(0, COALESCE("stockQuantity", 0) + ${stockDelta})
          ELSE ${quantity}
        END,
        status = CASE
          WHEN (
            CASE
              WHEN ${applyDelta} THEN GREATEST(0, COALESCE("stockQuantity", 0) + ${stockDelta})
              ELSE ${quantity}
            END
          ) <= 0 THEN 'SOLD_OUT'::"ListingStatus"
          WHEN status = 'SOLD_OUT'::"ListingStatus" AND NOT "isPrivate" THEN 'ACTIVE'::"ListingStatus"
          ELSE status
        END,
        "updatedAt" = NOW()
      WHERE id = ${id}
        AND "sellerId" = ${listing.seller.id}
      RETURNING id, title, "stockQuantity", status::text AS status
    `;
    const updated = updatedRows[0];
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Track listingsBelowThresholdSince for Guild Member revocation check
    await syncGuildMemberListingThreshold(listing.seller.id);
    if (listing.status !== updated.status) {
      revalidateListingSearchCaches();
    }

    // If stock is low (1–2), notify the seller
    if (updated.stockQuantity !== null && updated.stockQuantity > 0 && updated.stockQuantity <= 2) {
      const lowStockLink = lowStockNotificationLink(id);
      const recentLowStock = await prisma.notification.findFirst({
        where: {
          userId: listing.seller.userId,
          type: "LOW_STOCK",
          link: lowStockLink,
          createdAt: { gte: new Date(Date.now() - LOW_STOCK_DEDUP_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (!recentLowStock) await createNotification({
        userId: listing.seller.userId,
        type: "LOW_STOCK",
        title: `${updated.title} is running low`,
        body: `Only ${updated.stockQuantity} left in stock — consider restocking soon`,
        link: lowStockLink,
      });
    }

    // If transitioning from SOLD_OUT -> ACTIVE, notify subscribers
    if (listing.status === "SOLD_OUT" && updated.status === "ACTIVE") {
      after(async () => {
        try {
          while (true) {
            const claimedSubscribers = await prisma.$queryRaw<{ userId: string; stockQuantity: number | null }[]>`
              WITH available_listing AS (
                SELECT id, "stockQuantity"
                FROM "Listing"
                WHERE id = ${id}
                  AND status = 'ACTIVE'::"ListingStatus"
                  AND COALESCE("stockQuantity", 0) > 0
              ),
              next_subscribers AS (
                SELECT sn.id
                FROM "StockNotification" sn
                INNER JOIN available_listing al ON al.id = sn."listingId"
                ORDER BY sn."createdAt" ASC, sn.id ASC
                LIMIT ${BACK_IN_STOCK_CLAIM_BATCH_SIZE}
              )
              DELETE FROM "StockNotification" sn
              USING next_subscribers ns, available_listing al
              WHERE sn.id = ns.id
              RETURNING sn."userId", al."stockQuantity"
            `;
            if (claimedSubscribers.length === 0) return;
            const stockQuantity = claimedSubscribers[0]?.stockQuantity ?? updated.stockQuantity;

            for (const userIdChunk of chunkArray(
              claimedSubscribers.map((sub) => sub.userId),
              BACK_IN_STOCK_USER_LOOKUP_BATCH_SIZE,
            )) {
              const activeSubscribers = await prisma.user.findMany({
                where: {
                  id: { in: userIdChunk },
                  banned: false,
                  deletedAt: null,
                },
                select: { id: true, name: true, email: true },
              });
              await mapWithConcurrency(activeSubscribers, 5, async (sub) => {
                await createNotification({
                  userId: sub.id,
                  type: "BACK_IN_STOCK",
                  title: `${updated.title} is back in stock!`,
                  body: stockAlertBody(stockQuantity),
                  link: publicListingPath(id, updated.title),
                });
                if (sub.email && await shouldSendEmail(sub.id, "EMAIL_BACK_IN_STOCK")) {
                  const email = renderBackInStockEmail({
                    buyer: { name: sub.name, email: sub.email },
                    listingTitle: updated.title,
                    listingId: id,
                  });
                  await enqueueEmailOutbox({
                    ...email,
                    dedupKey: `back-in-stock:${id}:${sub.id}`,
                    userId: sub.id,
                    preferenceKey: "EMAIL_BACK_IN_STOCK",
                  });
                }
              });
            }

            if (claimedSubscribers.length < BACK_IN_STOCK_CLAIM_BATCH_SIZE) return;
          }
        } catch (error) {
          Sentry.captureException(error, {
            level: "warning",
            tags: { source: "stock_back_in_stock_fanout" },
            extra: { listingId: id, sellerProfileId: listing.seller.id },
          });
        }
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("PATCH /api/listings/[id]/stock error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
