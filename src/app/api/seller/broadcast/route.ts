// src/app/api/seller/broadcast/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { userClerkGate } from "@/lib/userIdentityAccess";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { isInAppNotificationEnabled } from "@/lib/notificationDeliveryPreferences";
import { renderSellerBroadcastEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { chunkArray, mapWithConcurrency } from "@/lib/concurrency";
import { userEmailDeliveryRecipients } from "@/lib/userEmailDeliveryAccess";
import { userOwnerBroadcastFollowers } from "@/lib/userFollowerAccess";
import {
  broadcastAttemptRatelimit,
  broadcastRatelimit,
  rateLimitResponse,
  safeRateLimit,
  sellerBroadcastReadRatelimit,
} from "@/lib/ratelimit";
import {
  sanitizeText,
  truncateText,
  truncateTextWithEllipsis,
} from "@/lib/sanitize";
import {
  isFirstPartyMediaUrl,
} from "@/lib/urlValidation";
import { verifyFirstPartyMediaUrlForPersistence } from "@/lib/uploadPersistenceVerification";
import { syncSellerBroadcastDirectUploadReferences } from "@/lib/directUploadLifecycle";
import { IMAGE_UPLOAD_TYPES } from "@/lib/uploadRules";
import { captureProfanityFlag } from "@/lib/profanityTelemetry";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { sellerOwnerCore } from "@/lib/sellerProfileOwnerAccess";
import { canDeliverSellerBroadcast } from "@/lib/sellerBroadcastDeliveryState";
import { isTextWithinCodePointRange } from "@/lib/textLength";
import { withSerializableDbUserContext } from "@/lib/dbUserContext";
import {
  createOwnerSellerBroadcast,
  ownerSellerBroadcastCooldown,
  ownerSellerBroadcastCount,
  ownerSellerBroadcastDeliverySource,
  ownerSellerBroadcastPage,
  recordOwnerSellerBroadcastDelivery,
} from "@/lib/sellerBroadcastAccess";
import { z } from "zod";

const BroadcastSchema = z.object({
  message: z.string().min(1).refine(
    (message) => isTextWithinCodePointRange(message, 1, 500),
    { message: "Message must be 500 characters or fewer" },
  ),
  imageUrl: z
    .string()
    .url()
    .regex(/^https:\/\//)
    .refine((u) => isFirstPartyMediaUrl(u), {
      message: "Invalid image URL origin",
    })
    .optional()
    .nullable(),
  sellersOnly: z.boolean().optional(),
});
const BROADCAST_BODY_MAX_BYTES = 32 * 1024;
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const me = await userClerkGate(prisma, userId);
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt)
    return privateJson({ error: "Account is suspended" }, { status: 403 });

  const seller = await sellerOwnerCore(me.id);
  if (!seller)
    return privateJson({ error: "No seller profile" }, { status: 403 });
  if (!seller.chargesEnabled || seller.vacationMode) {
    return privateJson(
      { error: "Your shop must be active before sending broadcasts." },
      { status: 403 },
    );
  }

  const { success: attemptOk, reset: attemptReset } = await safeRateLimit(
    broadcastAttemptRatelimit,
    seller.sellerProfileId,
  );
  if (!attemptOk)
    return privateResponse(
      rateLimitResponse(
        attemptReset,
        "Too many broadcast attempts.",
      ),
    );

  let broadcastParsed;
  try {
    broadcastParsed = BroadcastSchema.parse(
      await readBoundedJson(req, BROADCAST_BODY_MAX_BYTES),
    );
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return privateJson({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(e)) {
      return privateJson({ error: "Invalid JSON" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return privateJson(
        { error: "Invalid input", details: e.issues },
        { status: 400 },
      );
    }
    throw e;
  }
  const message = truncateText(
    sanitizeText(broadcastParsed.message.trim()),
    500,
  );
  const imageUrl = broadcastParsed.imageUrl?.trim() || null;
  const sellersOnly = broadcastParsed.sellersOnly === true;

  if (!message)
    return privateJson({ error: "Message is required" }, { status: 400 });
  if (imageUrl) {
    const verification = await verifyFirstPartyMediaUrlForPersistence({
      url: imageUrl,
      allowedEndpoints: [
        "listingImage",
        "bannerImage",
        "galleryImage",
      ],
      clerkUserId: userId,
      accountUserId: me.id,
      allowedContentTypes: IMAGE_UPLOAD_TYPES,
    });
    if (!verification.ok) {
      return privateJson(
        { error: "Use an uploaded Grainline image for this update." },
        { status: 400 },
      );
    }
  }

  // Profanity check (log-only)
  const { containsProfanity, containsSlur, SHOP_TEXT_SLUR_MESSAGE } = await import("@/lib/profanity");
  if (containsSlur(message)) {
    return privateJson({ error: SHOP_TEXT_SLUR_MESSAGE }, { status: 400 });
  }
  const profCheck = containsProfanity(message);
  if (profCheck.flagged) {
    captureProfanityFlag({
      source: "seller_broadcast",
      matchCount: profCheck.matches.length,
      extra: { sellerProfileId: seller.sellerProfileId },
    });
  }

  // Enforce 7-day rate limit between broadcasts
  const cooldown = await ownerSellerBroadcastCooldown(me.id);
  if (cooldown.nextAvailableAt && cooldown.nextAvailableAt.getTime() > Date.now()) {
    return privateJson(
      {
        error: "You can send one broadcast per week.",
        nextAvailableAt: cooldown.nextAvailableAt.toISOString(),
      },
      { status: 429 },
    );
  }

  // Get followers (optionally filtered to sellers only)
  const followers = await userOwnerBroadcastFollowers(me.id, {
    sellerProfileId: seller.sellerProfileId,
    sellersOnly,
  });
  const notificationFollowers = followers.filter((f) =>
    isInAppNotificationEnabled(
      f.notificationPreferences,
      "SELLER_BROADCAST",
    ),
  );
  const { success: rlOk, reset } = await safeRateLimit(
    broadcastRatelimit,
    seller.sellerProfileId,
  );
  if (!rlOk)
    return privateResponse(
      rateLimitResponse(reset, "You can send one broadcast per week."),
    );

  // Create broadcast record, rechecking the durable DB cooldown inside the
  // transaction so the Redis weekly limiter is not the only concurrency guard.
  const broadcastResult = await withSerializableDbUserContext(me.id, async (tx) => {
    const created = await createOwnerSellerBroadcast(tx, {
        message,
        imageUrl,
        provisionalRecipientCount: notificationFollowers.length,
    });
    if (!created.created) return created;
    await syncSellerBroadcastDirectUploadReferences({
      client: tx,
      userId: me.id,
      sellerBroadcastId: created.id,
      requireAllTracked: Boolean(imageUrl),
    });
    return created;
  });

  if (!broadcastResult.created) {
    return privateJson(
      {
        error: "You can send one broadcast per week.",
        nextAvailableAt: broadcastResult.nextAvailableAt.toISOString(),
      },
      { status: 429 },
    );
  }
  const broadcast = { id: broadcastResult.id };

  // Send notifications after response; avoids losing work on function teardown.
  after(async () => {
    try {
      const [currentBroadcast, currentSeller] = await Promise.all([
        ownerSellerBroadcastDeliverySource(me.id, broadcast.id),
        sellerOwnerCore(me.id),
      ]);
      if (!canDeliverSellerBroadcast(
        currentBroadcast,
        currentSeller,
      )) {
        return;
      }
      const sellerName = seller.displayName ?? "A maker you follow";
      const results = await mapWithConcurrency(notificationFollowers, 10, (f) =>
        createNotification({
          userId: f.followerId,
          type: "SELLER_BROADCAST",
          title: `Update from ${sellerName}`,
          body: truncateTextWithEllipsis(message, 100),
          link: `/account/feed?broadcast=${broadcast.id}`,
          dedupScope: broadcast.id,
          sourceType: NOTIFICATION_SOURCE_TYPES.SELLER_BROADCAST,
          sourceId: broadcast.id,
          relatedUserId: me.id,
        }),
      );
      results.forEach((result, index) => {
        if (result.status !== "rejected") return;
        Sentry.captureException(result.reason, {
          level: "warning",
          tags: { source: "seller_broadcast_notification" },
          extra: {
            broadcastId: broadcast.id,
            sellerProfileId: seller.sellerProfileId,
            followerId: notificationFollowers[index]?.followerId ?? null,
          },
        });
      });
      const deliveredCount = results.reduce(
        (count, result) =>
          count + (result.status === "fulfilled" && result.value ? 1 : 0),
        0,
      );
      if (deliveredCount !== notificationFollowers.length) {
        await recordOwnerSellerBroadcastDelivery(me.id, broadcast.id, deliveredCount);
      }
      const emailFollowers = (await Promise.all(
        chunkArray(followers.map((f) => f.followerId), 500).map((userIds) =>
          userEmailDeliveryRecipients(prisma, {
            userIds,
            preferenceKey: "EMAIL_SELLER_BROADCAST",
          }),
        ),
      )).flat();
      const emailResults = await mapWithConcurrency(
        emailFollowers,
        5,
        async (f) => {
          const email = renderSellerBroadcastEmail({
            to: f.email,
            makerName: sellerName,
            message,
            imageUrl,
          });
          return enqueueEmailOutbox({
            ...email,
            dedupKey: `seller-broadcast:${broadcast.id}:${f.userId}`,
            templateName: "seller_broadcast",
            userId: f.userId,
            preferenceKey: "EMAIL_SELLER_BROADCAST",
            sourceType: "seller_broadcast",
            sourceId: broadcast.id,
          });
        },
      );
      emailResults.forEach((result, index) => {
        if (result.status !== "rejected") return;
        Sentry.captureException(result.reason, {
          level: "warning",
          tags: { source: "seller_broadcast_email" },
          extra: {
            broadcastId: broadcast.id,
            sellerProfileId: seller.sellerProfileId,
            followerId: emailFollowers[index]?.userId ?? null,
          },
        });
      });
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "seller_broadcast_after" },
        extra: {
          broadcastId: broadcast.id,
          sellerProfileId: seller.sellerProfileId,
        },
      });
    }
  });

  return privateJson({
    broadcastId: broadcast.id,
    recipientCount: notificationFollowers.length,
  });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(
    sellerBroadcastReadRatelimit,
    userId,
  );
  if (!success)
    return privateResponse(
      rateLimitResponse(reset, "Too many broadcast history requests."),
    );

  const me = await userClerkGate(prisma, userId);
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt)
    return privateJson({ error: "Account is suspended" }, { status: 403 });

  const seller = await sellerOwnerCore(me.id);
  if (!seller)
    return privateJson({ error: "No seller profile" }, { status: 403 });

  const url = new URL(req.url);
  const page = parseBoundedPositiveIntParam(
    url.searchParams.get("page"),
    1,
    1000,
  );
  const pageSize = 10;

  const [broadcasts, total] = await Promise.all([
    ownerSellerBroadcastPage(me.id, {
      offset: (page - 1) * pageSize,
      limit: pageSize,
    }),
    ownerSellerBroadcastCount(me.id),
  ]);

  return privateJson({ broadcasts, total, page, pageSize });
}
