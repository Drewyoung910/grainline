// src/app/api/commission/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { CommissionStatus, Category } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { commissionCreateRatelimit, rateLimitResponse } from "@/lib/ratelimit";
import { sanitizeText, sanitizeRichText } from "@/lib/sanitize";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const category = url.searchParams.get("category") ?? "";
  const pageSize = 20;

  const categoryValid = category && CATEGORY_VALUES.includes(category as Category);

  const where = {
    status: CommissionStatus.OPEN,
    ...(categoryValid ? { category: category as Category } : {}),
  };

  const [requests, total] = await Promise.all([
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
        expiresAt: true,
        createdAt: true,
        buyer: { select: { name: true, imageUrl: true } },
      },
    }),
    prisma.commissionRequest.count({ where }),
  ]);

  return NextResponse.json({ requests, total, page, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await commissionCreateRatelimit.limit(userId);
  if (!rlOk) return rateLimitResponse(reset, "You can post up to 5 commission requests per day.");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, sellerProfile: { select: { lat: true, lng: true } } },
  });
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { title, description, category, budgetMin, budgetMax, timeline, referenceImageUrls, isNational } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Title required" }, { status: 400 });
  }
  if (!description || typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "Description required" }, { status: 400 });
  }
  if (title.trim().length > 100) {
    return NextResponse.json({ error: "Title must be 100 chars or fewer" }, { status: 400 });
  }
  if (description.trim().length > 1000) {
    return NextResponse.json({ error: "Description must be 1000 chars or fewer" }, { status: 400 });
  }

  const categoryValid = category && CATEGORY_VALUES.includes(category as Category);
  const budgetMinCents = budgetMin ? Math.round(Number(budgetMin) * 100) : null;
  const budgetMaxCents = budgetMax ? Math.round(Number(budgetMax) * 100) : null;
  const images = Array.isArray(referenceImageUrls) ? referenceImageUrls.slice(0, 3) : [];

  if (budgetMinCents !== null && budgetMinCents < 0) return NextResponse.json({ error: "Budget cannot be negative." }, { status: 400 });
  if (budgetMaxCents !== null && budgetMinCents !== null && budgetMaxCents < budgetMinCents) return NextResponse.json({ error: "Maximum budget must be greater than minimum." }, { status: 400 });

  // Resolve location for local scope
  const wantsLocal = isNational === false || isNational === "false";
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
      isNational: reqIsNational,
      lat: reqLat,
      lng: reqLng,
    },
  });

  return NextResponse.json({ id: request.id });
}
