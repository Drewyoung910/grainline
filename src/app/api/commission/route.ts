// src/app/api/commission/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Category } from "@prisma/client";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getBlockedIdsFor } from "@/lib/blocks";
import { CATEGORY_VALUES } from "@/lib/categories";
import {
  commissionCreateRatelimit,
  commissionReferenceImageIpRatelimit,
  getIP,
  rateLimitResponse,
  safeRateLimit,
  searchRatelimit,
} from "@/lib/ratelimit";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";
import { containsProfanity } from "@/lib/profanity";
import { captureProfanityFlag } from "@/lib/profanityTelemetry";
import { commissionExpiresAt, openCommissionWhere } from "@/lib/commissionExpiry";
import { publicCommissionInterestWhere, resolvedInterestedCount } from "@/lib/commissionInterestCount";
import { isFirstPartyMediaUrl } from "@/lib/urlValidation";
import { filterVerifiedFirstPartyMediaUrlsForUser } from "@/lib/uploadPersistenceVerification";
import { claimDirectUploadsForUrls } from "@/lib/directUploadLifecycle";
import { parseMoneyInputToCents } from "@/lib/money";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { logServerError } from "@/lib/serverErrorLogger";
import { z } from "zod";

const BudgetInputSchema = z.union([z.string().max(20), z.number().finite()]);

const CommissionCreateSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().min(1).max(1000),
  category: z.string().optional().nullable(),
  budgetMin: BudgetInputSchema.optional().nullable(),
  budgetMax: BudgetInputSchema.optional().nullable(),
  timeline: z.string().max(200).optional().nullable(),
  referenceImageUrls: z.array(z.string().url().refine(
    (u) => isFirstPartyMediaUrl(u),
    { message: "Invalid image URL" }
  )).max(3).optional(),
  isNational: z.boolean().optional(),
});
const COMMISSION_CREATE_BODY_MAX_BYTES = 24 * 1024;

export async function GET(req: NextRequest) {
  const rate = await safeRateLimit(searchRatelimit, getIP(req));
  if (!rate.success) return privateResponse(rateLimitResponse(rate.reset, "Too many commission requests."));

  const url = new URL(req.url);
  const page = parseBoundedPositiveIntParam(url.searchParams.get("page"), 1, 1000);
  const category = url.searchParams.get("category") ?? "";
  const pageSize = 20;

  const categoryValid = category && CATEGORY_VALUES.includes(category as Category);

  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meId = me?.id ?? null;
  }
  const { blockedUserIds, blockedSellerIds } = await getBlockedIdsFor(meId);

  const where = openCommissionWhere({
    ...(categoryValid ? { category: category as Category } : {}),
    ...(blockedUserIds.size > 0 ? { buyerId: { notIn: [...blockedUserIds] } } : {}),
  });
  const visibleInterestWhere = publicCommissionInterestWhere(
    blockedSellerIds.length > 0 ? { sellerProfileId: { notIn: blockedSellerIds } } : {},
  );

  const total = await prisma.commissionRequest.count({ where });
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
  const requestRows = await prisma.commissionRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    skip: (currentPage - 1) * pageSize,
    take: pageSize,
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
      _count: { select: { interests: { where: visibleInterestWhere } } },
      expiresAt: true,
      createdAt: true,
      buyer: { select: { name: true, imageUrl: true } },
    },
  });
  const requests = requestRows.map(({ _count, ...request }) => ({
    ...request,
    interestedCount: resolvedInterestedCount({
      interestedCount: request.interestedCount,
      _count,
    }),
  }));

  return privateJson({ requests, total, page: currentPage, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const { success: rlOk, reset } = await safeRateLimit(commissionCreateRatelimit, userId);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "You can post up to 5 commission requests per day."));

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true, sellerProfile: { select: { lat: true, lng: true } } },
  });
  if (!me) return privateJson({ error: "User not found" }, { status: HTTP_STATUS.UNAUTHORIZED });
  if (me.banned || me.deletedAt) return privateJson({ error: "Account is suspended" }, { status: HTTP_STATUS.FORBIDDEN });

  let parsed;
  try {
    parsed = CommissionCreateSchema.parse(await readBoundedJson(req, COMMISSION_CREATE_BODY_MAX_BYTES));
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
  const { title, description, category, budgetMin, budgetMax, timeline, referenceImageUrls, isNational } = parsed;
  if ((referenceImageUrls?.length ?? 0) > 0) {
    const { success: imageIpOk, reset: imageIpReset } = await safeRateLimit(
      commissionReferenceImageIpRatelimit,
      getIP(req),
    );
    if (!imageIpOk) {
      return privateResponse(rateLimitResponse(imageIpReset, "Too many commission requests with reference images from this network."));
    }
  }

  // Profanity check (log-only — does not block submission)
  {
    const profanityResult = containsProfanity(`${title} ${description}`);
    if (profanityResult.flagged) {
      captureProfanityFlag({
        source: "commission_create",
        matchCount: profanityResult.matches.length,
        extra: { clerkUserId: userId },
      });
    }
  }

  const categoryValid = category && CATEGORY_VALUES.includes(category as Category);
  const budgetMinCents = budgetMin != null ? parseMoneyInputToCents(budgetMin) : null;
  const budgetMaxCents = budgetMax != null ? parseMoneyInputToCents(budgetMax) : null;
  const images = await filterVerifiedFirstPartyMediaUrlsForUser({
    urls: referenceImageUrls ?? [],
    max: 3,
    clerkUserId: userId,
    accountUserId: me.id,
    allowedEndpoints: ["messageImage"],
  });

  if (budgetMin != null && budgetMinCents === null) return privateJson({ error: "Minimum budget must be a valid dollar amount." }, { status: HTTP_STATUS.BAD_REQUEST });
  if (budgetMax != null && budgetMaxCents === null) return privateJson({ error: "Maximum budget must be a valid dollar amount." }, { status: HTTP_STATUS.BAD_REQUEST });
  if (budgetMinCents !== null && budgetMinCents > 10_000_000) return privateJson({ error: "Minimum budget cannot exceed $100,000." }, { status: HTTP_STATUS.BAD_REQUEST });
  if (budgetMaxCents !== null && budgetMaxCents > 10_000_000) return privateJson({ error: "Maximum budget cannot exceed $100,000." }, { status: HTTP_STATUS.BAD_REQUEST });
  if (budgetMaxCents !== null && budgetMinCents !== null && budgetMaxCents < budgetMinCents) return privateJson({ error: "Maximum budget must be greater than minimum." }, { status: HTTP_STATUS.BAD_REQUEST });

  // Resolve location for local scope
  const wantsLocal = isNational === false;
  let reqLat: number | null = null;
  let reqLng: number | null = null;
  let reqIsNational = true;

  if (wantsLocal) {
    const sellerLat = me.sellerProfile?.lat;
    const sellerLng = me.sellerProfile?.lng;
    if (sellerLat == null || sellerLng == null) {
      return privateJson(
        { error: "Please set your location in your seller profile before posting a local request" },
        { status: HTTP_STATUS.BAD_REQUEST }
      );
    }
    reqLat = Number(sellerLat);
    reqLng = Number(sellerLng);
    reqIsNational = false;
  }

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.commissionRequest.create({
      data: {
        buyerId: me.id,
        title: sanitizeText(title.trim()),
        description: sanitizeRichText(description.trim()),
        category: categoryValid ? (category as Category) : null,
        budgetMinCents,
        budgetMaxCents,
        timeline: timeline ? sanitizeText(timeline.trim()) || null : null,
        referenceImageUrls: images,
        expiresAt: commissionExpiresAt(),
        isNational: reqIsNational,
        lat: reqLat,
        lng: reqLng,
      },
    });
    await claimDirectUploadsForUrls({
      client: tx,
      urls: images,
      userId: me.id,
      claimedByType: "CommissionRequest",
      claimedById: created.id,
    });
    return created;
  });

  // Assign metro geography — non-fatal
  if (reqLat != null && reqLng != null) {
    try {
      const { findOrCreateMetro } = await import("@/lib/geo-metro");
      const { metroId, cityMetroId } = await findOrCreateMetro(reqLat, reqLng);
      if (metroId || cityMetroId) {
        await prisma.commissionRequest.update({ where: { id: request.id }, data: { metroId, cityMetroId } });
      }
    } catch (e) {
      logServerError(e, {
        source: "commission_geo_assignment",
        level: "warning",
        extra: { commissionRequestId: request.id },
      });
    }
  }

  return privateJson({ id: request.id });
}
