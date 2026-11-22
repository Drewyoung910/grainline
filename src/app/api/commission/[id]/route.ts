// src/app/api/commission/[id]/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { userClerkGate, userIdByClerkId } from "@/lib/userIdentityAccess";
import { CommissionStatus } from "@prisma/client";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import {
  publicCommissionInterestCards,
  publicCommissionInterestCounts,
} from "@/lib/commissionInterestCount";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  publicCommissionRequestDetail,
  transitionOwnerCommissionRequest,
} from "@/lib/commissionRequestAccess";
import { commissionStatusRatelimit, getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";

const CommissionPatchSchema = z.object({
  status: z.enum(["FULFILLED", "CLOSED"]),
});

const COMMISSION_INTEREST_DISPLAY_LIMIT = 100;
const COMMISSION_STATUS_BODY_MAX_BYTES = 8 * 1024;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { success, reset } = await safeRateLimit(searchRatelimit, getIP(req));
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many commission reads."));

  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await userIdByClerkId(prisma, userId);
    meId = me?.id ?? null;
  }
  const request = await publicCommissionRequestDetail(meId, id);

  if (!request) return privateJson({ error: "Not found" }, { status: 404 });

  const [interestCounts, interests] = await Promise.all([
    publicCommissionInterestCounts([request.id], meId),
    publicCommissionInterestCards(request.id, meId, COMMISSION_INTEREST_DISPLAY_LIMIT),
  ]);
  return privateJson({
    id: request.id,
    title: request.title,
    description: request.description,
    category: request.category,
    budgetMinCents: request.budgetMinCents,
    budgetMaxCents: request.budgetMaxCents,
    timeline: request.timeline,
    referenceImageUrls: request.referenceImageUrls,
    status: request.status,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    interestedCount: interestCounts.get(request.id) ?? 0,
    buyer: { name: request.buyerName, imageUrl: request.buyerImageUrl },
    interests: interests.map((interest) => ({
      createdAt: interest.createdAt,
      sellerProfile: interest.sellerProfile,
    })),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(commissionStatusRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many commission status updates."));

  const me = await userClerkGate(prisma, userId);
  if (!me) return privateJson({ error: "User not found" }, { status: 401 });
  if (me.banned || me.deletedAt) return privateJson({ error: "Account is suspended" }, { status: 403 });

  let patchParsed;
  try {
    patchParsed = CommissionPatchSchema.parse(await readBoundedJson(req, COMMISSION_STATUS_BODY_MAX_BYTES));
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return privateJson({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(e)) {
      return privateJson({ error: "Invalid JSON" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return privateJson({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    throw e;
  }
  const { status } = patchParsed;
  const transition = await transitionOwnerCommissionRequest(
    me.id,
    id,
    status,
  );
  if (transition.outcome === "not_found") {
    return privateJson({ error: "Not found" }, { status: 404 });
  }
  if (transition.outcome === "needs_interest") {
    return privateJson({ error: "A commission request needs at least one interested maker before it can be fulfilled." }, { status: 400 });
  }
  if (transition.outcome === "not_open") {
    return privateJson({ error: "Commission request is no longer open" }, { status: 409 });
  }
  const updated = { id, status: status as CommissionStatus };

  // Notify interested sellers
  const isFulfilled = (status as CommissionStatus) === CommissionStatus.FULFILLED;
  after(async () => {
    try {
      await mapWithConcurrency(
        transition.sellerUserIds,
        10,
        (interestedSellerUserId) =>
          createNotification({
            userId: interestedSellerUserId,
            type: "COMMISSION_INTEREST",
            title: isFulfilled ? "Commission request fulfilled" : "Commission request closed",
            body: isFulfilled
              ? `The request "${transition.title}" has been fulfilled. Thanks for your interest!`
              : `The request "${transition.title}" has been closed by the buyer.`,
            link: isFulfilled ? `/commission/${id}` : `/commission`,
            dedupScope: id,
            relatedUserId: me.id,
            sourceType: NOTIFICATION_SOURCE_TYPES.COMMISSION_REQUEST,
            sourceId: id,
          }),
      );
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "commission_status_notification" },
        extra: {
          commissionRequestId: id,
          status,
          interestedSellerCount: transition.sellerUserIds.length,
        },
      });
    }
  });

  return privateJson(updated);
}
