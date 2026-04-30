import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Category, ListingType } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { z } from "zod";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { rateLimitResponse, safeRateLimit, savedSearchRatelimit } from "@/lib/ratelimit";
import { normalizeTags } from "@/lib/tags";
import { truncateText } from "@/lib/sanitize";

const SavedSearchSchema = z.object({
  q: z.string().max(200).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  type: z.enum(["IN_STOCK", "MADE_TO_ORDER"]).optional().nullable(),
  shipsWithinDays: z.number().int().min(1).max(365).optional().nullable(),
  minRating: z.number().int().min(1).max(5).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  radiusMiles: z.number().int().min(1).max(500).optional().nullable(),
  sort: z.enum(["relevant", "newest", "price_asc", "price_desc", "popular"]).optional().nullable(),
  minPrice: z.number().min(0).max(10_000_000).optional().nullable(),
  maxPrice: z.number().min(0).max(10_000_000).optional().nullable(),
  tags: z.array(z.string().min(1).max(100)).max(20).optional(),
});

async function getDbUser() {
  const { userId } = await auth();
  if (!userId) return null;
  return ensureUser();
}

async function getDbUserResult() {
  try {
    return { me: await getDbUser(), response: null };
  } catch (err) {
    const response = accountAccessErrorResponse(err);
    if (response) return { me: null, response };
    throw err;
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success, reset } = await safeRateLimit(savedSearchRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many saved-search actions.");

  const userResult = await getDbUserResult();
  if (userResult.response) return userResult.response;
  const me = userResult.me;
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let searchParsed;
  try {
    searchParsed = SavedSearchSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { q, category, type, shipsWithinDays, minRating, lat, lng, radiusMiles, sort, minPrice, maxPrice, tags } = searchParsed;

  const categoryRaw = (category ?? "").toUpperCase();
  const categoryVal: Category | null = CATEGORY_VALUES.includes(categoryRaw)
    ? (categoryRaw as Category)
    : null;

  const normalizedQuery = q ? truncateText(q.trim().replace(/\s+/g, " "), 200) || null : null;
  const listingType = type === "IN_STOCK" || type === "MADE_TO_ORDER" ? (type as ListingType) : null;
  const normalizedTags = normalizeTags(tags ?? [], 20);
  const normalizedMin = typeof minPrice === "number" && Number.isFinite(minPrice) ? minPrice : null;
  const normalizedMax = typeof maxPrice === "number" && Number.isFinite(maxPrice) ? maxPrice : null;
  const normalizedShips = typeof shipsWithinDays === "number" && Number.isFinite(shipsWithinDays) ? shipsWithinDays : null;
  const normalizedRating = typeof minRating === "number" && Number.isFinite(minRating) ? minRating : null;
  const normalizedLat = typeof lat === "number" && Number.isFinite(lat) ? Number(lat.toFixed(5)) : null;
  const normalizedLng = typeof lng === "number" && Number.isFinite(lng) ? Number(lng.toFixed(5)) : null;
  const normalizedRadius = typeof radiusMiles === "number" && Number.isFinite(radiusMiles) ? radiusMiles : null;
  const normalizedSort = sort ?? null;

  if (normalizedMin !== null && normalizedMax !== null && normalizedMin > normalizedMax) {
    return NextResponse.json({ error: "Minimum price cannot exceed maximum price" }, { status: 400 });
  }
  if ((normalizedLat === null) !== (normalizedLng === null) || ((normalizedLat !== null || normalizedLng !== null) && normalizedRadius === null)) {
    return NextResponse.json({ error: "Location searches require latitude, longitude, and radius" }, { status: 400 });
  }
  const hasMeaningfulCriteria =
    normalizedQuery !== null ||
    categoryVal !== null ||
    listingType !== null ||
    normalizedShips !== null ||
    normalizedRating !== null ||
    normalizedLat !== null ||
    normalizedMin !== null ||
    normalizedMax !== null ||
    normalizedTags.length > 0;
  if (!hasMeaningfulCriteria) {
    return NextResponse.json({ error: "Choose at least one search term or filter before saving." }, { status: 400 });
  }

  const existing = await prisma.savedSearch.findFirst({
    where: {
      userId: me.id,
      query: normalizedQuery,
      category: categoryVal,
      listingType,
      shipsWithinDays: normalizedShips,
      minRating: normalizedRating,
      lat: normalizedLat,
      lng: normalizedLng,
      radiusMiles: normalizedRadius,
      sort: normalizedSort,
      minPrice: normalizedMin,
      maxPrice: normalizedMax,
      tags: { equals: normalizedTags },
    },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ ok: true, id: existing.id, existing: true });

  const count = await prisma.savedSearch.count({ where: { userId: me.id } });
  if (count >= 25) {
    return NextResponse.json({ error: "You can save up to 25 searches. Delete one before saving another." }, { status: 400 });
  }

  const saved = await prisma.savedSearch.create({
    data: {
      userId: me.id,
      query: normalizedQuery,
      category: categoryVal,
      listingType,
      shipsWithinDays: normalizedShips,
      minRating: normalizedRating,
      lat: normalizedLat,
      lng: normalizedLng,
      radiusMiles: normalizedRadius,
      sort: normalizedSort,
      minPrice: normalizedMin,
      maxPrice: normalizedMax,
      tags: normalizedTags,
    },
  });

  return NextResponse.json({ ok: true, id: saved.id });
}

export async function GET() {
  const userResult = await getDbUserResult();
  if (userResult.response) return userResult.response;
  const me = userResult.me;
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const searches = await prisma.savedSearch.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ searches });
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success, reset } = await safeRateLimit(savedSearchRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many saved-search actions.");

  const userResult = await getDbUserResult();
  if (userResult.response) return userResult.response;
  const me = userResult.me;
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.savedSearch.deleteMany({ where: { id, userId: me.id } });
  return NextResponse.json({ ok: true });
}
