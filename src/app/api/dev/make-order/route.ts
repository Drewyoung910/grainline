// src/app/api/dev/make-order/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { privateJson } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { z } from "zod";

const DevOrderSchema = z.object({
  listingId: z.string().min(1),
});
const DEV_MAKE_ORDER_BODY_MAX_BYTES = 8 * 1024;

function devFixturesEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.VERCEL !== "1" &&
    process.env.VERCEL_ENV === undefined &&
    process.env.ENABLE_DEV_MAKE_ORDER === "true"
  );
}

export async function POST(req: Request) {
  if (!devFixturesEnabled()) {
    return privateJson({ error: "Disabled" }, { status: HTTP_STATUS.NOT_FOUND });
  }

  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  if (me.banned || me.deletedAt) return privateJson({ error: "Account is suspended" }, { status: HTTP_STATUS.FORBIDDEN });

  let devParsed;
  try {
    devParsed = DevOrderSchema.parse(await readBoundedJson(req, DEV_MAKE_ORDER_BODY_MAX_BYTES));
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    if (isInvalidJsonBodyError(e)) {
      return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    if (e instanceof z.ZodError) {
      return privateJson({ error: "Invalid input", details: e.issues }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    throw e;
  }
  const { listingId } = devParsed;

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      sellerId: true,
      title: true,
      description: true,
      priceCents: true,
      category: true,
      tags: true,
      listingType: true,
      processingTimeMinDays: true,
      processingTimeMaxDays: true,
      shipsWithinDays: true,
      photos: { orderBy: { sortOrder: "asc" }, select: { url: true } },
      seller: { select: { displayName: true } },
    },
  });
  if (!listing) return privateJson({ error: "Listing not found" }, { status: HTTP_STATUS.NOT_FOUND });

  const order = await prisma.order.create({
    data: {
      buyerId: me.id,
      sellerProfileId: listing.sellerId,
      paidAt: new Date(),
      items: {
        create: [{
          listingId,
          sellerProfileId: listing.sellerId,
          quantity: 1,
          priceCents: listing.priceCents,
          listingSnapshot: {
            title: listing.title,
            description: listing.description,
            priceCents: listing.priceCents,
            imageUrls: listing.photos.map((photo) => photo.url),
            category: listing.category,
            tags: listing.tags,
            sellerName: listing.seller.displayName,
            listingType: listing.listingType,
            processingTimeMinDays: listing.processingTimeMinDays,
            processingTimeMaxDays: listing.processingTimeMaxDays,
            shipsWithinDays: listing.shipsWithinDays,
            capturedAt: new Date().toISOString(),
          },
        }],
      },
    },
    include: { items: true },
  });

  return privateJson({ ok: true, orderId: order.id, items: order.items });
}
