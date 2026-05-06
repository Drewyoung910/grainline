// src/app/api/commission/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Category } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import {
  commissionCreateRatelimit,
  commissionReferenceImageIpRatelimit,
  getIP,
  rateLimitResponse,
  safeRateLimit,
} from "@/lib/ratelimit";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";
import { containsProfanity } from "@/lib/profanity";
import { commissionExpiresAt, openCommissionWhere } from "@/lib/commissionExpiry";
import { resolvedInterestedCount } from "@/lib/commissionInterestCount";
import { filterR2PublicUrls, isR2PublicUrl } from "@/lib/urlValidation";
import { parseMoneyInputToCents } from "@/lib/money";
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
    (u) => isR2PublicUrl(u),
    { message: "Invalid image URL" }
  )).max(3).optional(),
  isNational: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const category = url.searchParams.get("category") ?? "";
  const pageSize = 20;

  const categoryValid = category && CATEGORY_VALUES.includes(category as Category);

  const where = openCommissionWhere({
    ...(categoryValid ? { category: category as Category } : {}),
  });

  const [requestRows, total] = await Promise.all([
    prisma.commissionRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
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
        _count: { select: { interests: true } },
        expiresAt: true,
        createdAt: true,
        buyer: { select: { name: true, imageUrl: true } },
      },
    }),
    prisma.commissionRequest.count({ where }),
  ]);
  const requests = requestRows.map(({ _count, ...request }) => ({
    ...request,
    interestedCount: resolvedInterestedCount({
      interestedCount: request.interestedCount,
      _count,
    }),
  }));

  return NextResponse.json({ requests, total, page, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(commissionCreateRatelimit, userId);
  if (!rlOk) return rateLimitResponse(reset, "You can post up to 5 commission requests per day.");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, banned: true, deletedAt: true, sellerProfile: { select: { lat: true, lng: true } } },
  });
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 401 });
  if (me.banned || me.deletedAt) return NextResponse.json({ error: "Account is suspended" }, { status: 403 });

  let parsed;
  try {
    parsed = CommissionCreateSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { title, description, category, budgetMin, budgetMax, timeline, referenceImageUrls, isNational } = parsed;
  if ((referenceImageUrls?.length ?? 0) > 0) {
    const { success: imageIpOk, reset: imageIpReset } = await safeRateLimit(
      commissionReferenceImageIpRatelimit,
      getIP(req),
    );
    if (!imageIpOk) {
      return rateLimitResponse(imageIpReset, "Too many commission requests with reference images from this network.");
    }
  }

  // Profanity check (log-only — does not block submission)
  {
    const profanityResult = containsProfanity(`${title} ${description}`);
    if (profanityResult.flagged) {
      console.error(`[PROFANITY] Commission request flagged — matches: ${profanityResult.matches.join(", ")}`);
    }
  }

  const categoryValid = category && CATEGORY_VALUES.includes(category as Category);
  const budgetMinCents = budgetMin != null ? parseMoneyInputToCents(budgetMin) : null;
  const budgetMaxCents = budgetMax != null ? parseMoneyInputToCents(budgetMax) : null;
  const images = filterR2PublicUrls(referenceImageUrls ?? [], 3);

  if (budgetMin != null && budgetMinCents === null) return NextResponse.json({ error: "Minimum budget must be a valid dollar amount." }, { status: 400 });
  if (budgetMax != null && budgetMaxCents === null) return NextResponse.json({ error: "Maximum budget must be a valid dollar amount." }, { status: 400 });
  if (budgetMinCents !== null && budgetMinCents > 10_000_000) return NextResponse.json({ error: "Minimum budget cannot exceed $100,000." }, { status: 400 });
  if (budgetMaxCents !== null && budgetMaxCents > 10_000_000) return NextResponse.json({ error: "Maximum budget cannot exceed $100,000." }, { status: 400 });
  if (budgetMaxCents !== null && budgetMinCents !== null && budgetMaxCents < budgetMinCents) return NextResponse.json({ error: "Maximum budget must be greater than minimum." }, { status: 400 });

  // Resolve location for local scope
  const wantsLocal = isNational === false;
  let reqLat: number | null = null;
  let reqLng: number | null = null;
  let reqIsNational = true;

  if (wantsLocal) {
    const sellerLat = me.sellerProfile?.lat;
    const sellerLng = me.sellerProfile?.lng;
    if (sellerLat == null || sellerLng == null) {
      return NextResponse.json(
        { error: "Please set your location in your seller profile before posting a local request" },
        { status: 400 }
      );
    }
    reqLat = Number(sellerLat);
    reqLng = Number(sellerLng);
    reqIsNational = false;
  }

  const request = await prisma.commissionRequest.create({
    data: {
      buyerId: me.id,
      title: sanitizeText(title.trim()),
      description: sanitizeRichText(description.trim()),
      category: categoryValid ? (category as Category) : null,
      budgetMinCents,
      budgetMaxCents,
      timeline: timeline?.trim() || null,
      referenceImageUrls: images,
      expiresAt: commissionExpiresAt(),
      isNational: reqIsNational,
      lat: reqLat,
      lng: reqLng,
    },
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
      console.error("[geo-metro] Failed to assign metro to commission:", e);
    }
  }

  return NextResponse.json({ id: request.id });
}
