// src/app/api/commission/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { CommissionStatus } from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import { commissionIsExpired } from "@/lib/commissionExpiry";
import { publicCommissionInterestWhere, resolvedInterestedCount } from "@/lib/commissionInterestCount";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { mapWithConcurrency } from "@/lib/concurrency";
import { openCommissionMutationWhere } from "@/lib/commissionState";
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
const COMMISSION_INTEREST_NOTIFY_LIMIT = 10000;
const COMMISSION_STATUS_BODY_MAX_BYTES = 8 * 1024;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { success, reset } = await safeRateLimit(searchRatelimit, getIP(req));
  if (!success) return rateLimitResponse(reset, "Too many commission reads.");

  const request = await prisma.commissionRequest.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      budgetMinCents: true,
      budgetMaxCents: true,
      timeline: true,
      referenceImageUrls: true,
      status: true,
      interestedCount: true,
      _count: { select: { interests: { where: publicCommissionInterestWhere() } } },
      expiresAt: true,
      createdAt: true,
      buyerId: true,
      buyer: { select: { name: true, imageUrl: true, banned: true, deletedAt: true } },
      interests: {
        where: {
          sellerProfile: activeSellerProfileWhere(),
        },
        take: COMMISSION_INTEREST_DISPLAY_LIMIT,
        select: {
          id: true,
          createdAt: true,
          sellerProfile: {
            select: {
              id: true,
              displayName: true,
              avatarImageUrl: true,
              guildLevel: true,
            },
          },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.buyer.banned || request.buyer.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (commissionIsExpired(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { _count, ...requestBody } = request;
  return NextResponse.json({
    ...requestBody,
    interestedCount: resolvedInterestedCount({
      interestedCount: request.interestedCount,
      _count,
    }),
    buyer: { name: request.buyer.name, imageUrl: request.buyer.imageUrl },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(commissionStatusRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many commission status updates.");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true },
  });
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 401 });
  if (me.banned || me.deletedAt) return NextResponse.json({ error: "Account is suspended" }, { status: 403 });

  const request = await prisma.commissionRequest.findUnique({
    where: { id },
    select: {
      buyerId: true,
      status: true,
      expiresAt: true,
      title: true,
      interests: {
        where: {
          sellerProfile: {
            user: { banned: false, deletedAt: null },
          },
        },
        take: COMMISSION_INTEREST_NOTIFY_LIMIT,
        select: {
          sellerProfile: { select: { userId: true } },
        },
      },
    },
  });
  if (!request) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (request.buyerId !== me.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (request.status !== CommissionStatus.OPEN) {
    return NextResponse.json({ error: "Commission request is no longer open" }, { status: 400 });
  }
  if (commissionIsExpired(request)) {
    return NextResponse.json({ error: "Commission request has expired" }, { status: 400 });
  }

  let patchParsed;
  try {
    patchParsed = CommissionPatchSchema.parse(await readBoundedJson(req, COMMISSION_STATUS_BODY_MAX_BYTES));
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
  const { status } = patchParsed;
  if ((status as CommissionStatus) === CommissionStatus.FULFILLED && request.interests.length === 0) {
    return NextResponse.json({ error: "A commission request needs at least one interested maker before it can be fulfilled." }, { status: 400 });
  }

  const result = await prisma.commissionRequest.updateMany({
    where: openCommissionMutationWhere(id, new Date(), { buyerId: me.id }),
    data: { status: status as CommissionStatus },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Commission request is no longer open" }, { status: 409 });
  }
  const updated = { id, status: status as CommissionStatus };

  // Notify interested sellers
  const isFulfilled = (status as CommissionStatus) === CommissionStatus.FULFILLED;
  after(async () => {
    try {
      await mapWithConcurrency(
        request.interests,
        10,
        (interest) =>
          createNotification({
            userId: interest.sellerProfile.userId,
            type: "COMMISSION_INTEREST",
            title: isFulfilled ? "Commission request fulfilled" : "Commission request closed",
            body: isFulfilled
              ? `The request "${request.title}" has been fulfilled. Thanks for your interest!`
              : `The request "${request.title}" has been closed by the buyer.`,
            link: isFulfilled ? `/commission/${id}` : `/commission`,
            dedupScope: id,
          }),
      );
    } catch (error) {
      Sentry.captureException(error, {
        level: "warning",
        tags: { source: "commission_status_notification" },
        extra: {
          commissionRequestId: id,
          status,
          interestedSellerCount: request.interests.length,
        },
      });
    }
  });

  return NextResponse.json(updated);
}
