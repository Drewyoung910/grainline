// src/app/api/seller/broadcast/route.ts
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { isInAppNotificationEnabled } from "@/lib/notificationDeliveryPreferences";
import { isEmailNotificationEnabled } from "@/lib/notificationEmailPreferences";
import { renderSellerBroadcastEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { mapWithConcurrency } from "@/lib/concurrency";
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
import { claimDirectUploadsForUrls } from "@/lib/directUploadLifecycle";
import { IMAGE_UPLOAD_TYPES } from "@/lib/uploadRules";
import { captureProfanityFlag } from "@/lib/profanityTelemetry";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { withSerializableRetry } from "@/lib/transactionRetry";
import { z } from "zod";

const BroadcastSchema = z.object({
  message: z.string().min(1).max(500),
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
const BROADCAST_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

function nextBroadcastAvailableAt(sentAt: Date) {
  return new Date(sentAt.getTime() + BROADCAST_COOLDOWN_MS);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt)
    return privateJson({ error: "Account is suspended" }, { status: 403 });

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: {
      id: true,
      displayName: true,
      chargesEnabled: true,
      vacationMode: true,
    },
  });
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
    seller.id,
  );
  if (!attemptOk)
    return privateResponse(
      rateLimitResponse(
        attemptReset,
        "Too many broadcast attempts. Please try again soon.",
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
  const { containsProfanity } = await import("@/lib/profanity");
  const profCheck = containsProfanity(message);
  if (profCheck.flagged) {
    captureProfanityFlag({
      source: "seller_broadcast",
      matchCount: profCheck.matches.length,
      extra: { sellerProfileId: seller.id },
    });
  }

  // Enforce 7-day rate limit between broadcasts
  const lastBroadcast = await prisma.sellerBroadcast.findFirst({
    where: { sellerProfileId: seller.id },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true },
  });
  if (lastBroadcast) {
    const daysSinceLast =
      (Date.now() - lastBroadcast.sentAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLast < 7) {
      const nextAvailable = nextBroadcastAvailableAt(lastBroadcast.sentAt);
      return privateJson(
        {
          error: "You can send one broadcast per week.",
          nextAvailableAt: nextAvailable.toISOString(),
        },
        { status: 429 },
      );
    }
  }

  // Get followers (optionally filtered to sellers only)
  const followers = await prisma.follow.findMany({
    where: {
      sellerProfileId: seller.id,
      followerId: { not: me.id },
      follower: {
        banned: false,
        deletedAt: null,
        blocks: { none: { blockedId: me.id } },
        blockedBy: { none: { blockerId: me.id } },
        ...(sellersOnly ? { sellerProfile: { isNot: null } } : {}),
      },
    },
    select: {
      followerId: true,
      follower: { select: { email: true, notificationPreferences: true } },
    },
    take: 10000,
  });
  const notificationFollowers = followers.filter((f) =>
    isInAppNotificationEnabled(
      f.follower.notificationPreferences,
      "SELLER_BROADCAST",
    ),
  );
  const emailFollowers = followers.filter(
    (f) =>
      !!f.follower.email &&
      isEmailNotificationEnabled(
        f.follower.notificationPreferences,
        "EMAIL_SELLER_BROADCAST",
      ),
  );

  const { success: rlOk, reset } = await safeRateLimit(
    broadcastRatelimit,
    seller.id,
  );
  if (!rlOk)
    return privateResponse(
      rateLimitResponse(reset, "You can send one broadcast per week."),
    );

  // Create broadcast record, rechecking the durable DB cooldown inside the
  // transaction so the Redis weekly limiter is not the only concurrency guard.
  const broadcastResult = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const latest = await tx.sellerBroadcast.findFirst({
      where: { sellerProfileId: seller.id },
      orderBy: { sentAt: "desc" },
      select: { sentAt: true },
    });
    if (latest && Date.now() - latest.sentAt.getTime() < BROADCAST_COOLDOWN_MS) {
      return {
        ok: false as const,
        nextAvailableAt: nextBroadcastAvailableAt(latest.sentAt),
      };
    }

    const created = await tx.sellerBroadcast.create({
      data: {
        sellerProfileId: seller.id,
        message,
        imageUrl,
        recipientCount: notificationFollowers.length,
      },
      select: { id: true },
    });
    if (imageUrl) {
      await claimDirectUploadsForUrls({
        client: tx,
        urls: [imageUrl],
        userId: me.id,
        claimedByType: "SellerBroadcast",
        claimedById: created.id,
      });
    }
    return { ok: true as const, broadcast: created };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

  if (!broadcastResult.ok) {
    return privateJson(
      {
        error: "You can send one broadcast per week.",
        nextAvailableAt: broadcastResult.nextAvailableAt.toISOString(),
      },
      { status: 429 },
    );
  }
  const { broadcast } = broadcastResult;

  // Send notifications after response; avoids losing work on function teardown.
  after(async () => {
    try {
      const currentBroadcast = await prisma.sellerBroadcast.findUnique({
        where: { id: broadcast.id },
        select: {
          sellerProfile: {
            select: {
              chargesEnabled: true,
              vacationMode: true,
              user: { select: { banned: true, deletedAt: true } },
            },
          },
        },
      });
      if (
        !currentBroadcast ||
        !currentBroadcast.sellerProfile.chargesEnabled ||
        currentBroadcast.sellerProfile.vacationMode ||
        currentBroadcast.sellerProfile.user.banned ||
        currentBroadcast.sellerProfile.user.deletedAt
      ) {
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
            sellerProfileId: seller.id,
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
        await prisma.sellerBroadcast.update({
          where: { id: broadcast.id },
          data: { recipientCount: deliveredCount },
        });
      }
      const emailResults = await mapWithConcurrency(
        emailFollowers,
        5,
        async (f) => {
          const email = renderSellerBroadcastEmail({
            to: f.follower.email!,
            makerName: sellerName,
            message,
            imageUrl,
          });
          return enqueueEmailOutbox({
            ...email,
            dedupKey: `seller-broadcast:${broadcast.id}:${f.followerId}`,
            templateName: "seller_broadcast",
            userId: f.followerId,
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
            sellerProfileId: seller.id,
            followerId: emailFollowers[index]?.followerId ?? null,
          },
        });
      });
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "seller_broadcast_after" },
        extra: { broadcastId: broadcast.id, sellerProfileId: seller.id },
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

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt)
    return privateJson({ error: "Account is suspended" }, { status: 403 });

  const seller = await prisma.sellerProfile.findUnique({
    where: { userId: me.id },
    select: { id: true },
  });
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
    prisma.sellerBroadcast.findMany({
      where: { sellerProfileId: seller.id },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        message: true,
        imageUrl: true,
        sentAt: true,
        recipientCount: true,
      },
    }),
    prisma.sellerBroadcast.count({ where: { sellerProfileId: seller.id } }),
  ]);

  return privateJson({ broadcasts, total, page, pageSize });
}
