import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Category, ListingType } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { z } from "zod";
import { ensureUser } from "@/lib/ensureUser";
import { prisma } from "@/lib/db";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { rateLimitResponse, safeRateLimit, savedSearchRatelimit } from "@/lib/ratelimit";
import { normalizeTags } from "@/lib/tags";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { withSerializableDbUserContext } from "@/lib/dbUserContext";
import {
  countOwnerSavedSearches,
  createOwnerSavedSearch,
  deleteOwnerSavedSearch,
  findDuplicateOwnerSavedSearch,
  listOwnerSavedSearches,
  type OwnerSavedSearchCriteria,
} from "@/lib/savedSearchOwnerAccess";

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
const SAVED_SEARCH_BODY_MAX_BYTES = 24 * 1024;

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

function normalizeSavedSearchTags(tags: string[] | undefined) {
  return normalizeTags(tags ?? [], 20).sort((a, b) => a.localeCompare(b));
}

function savedSearchCoordinateForTransport(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

export async function POST(req: NextRequest) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });
  const { success, reset } = await safeRateLimit(savedSearchRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many saved-search actions."));

  const userResult = await getDbUserResult();
  if (userResult.response) return userResult.response;
  const me = userResult.me;
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  let searchParsed;
  try {
    searchParsed = SavedSearchSchema.parse(await readBoundedJson(req, SAVED_SEARCH_BODY_MAX_BYTES));
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
  const { q, category, type, shipsWithinDays, minRating, lat, lng, radiusMiles, sort, minPrice, maxPrice, tags } = searchParsed;

  const categoryRaw = (category ?? "").toUpperCase();
  const categoryVal: Category | null = CATEGORY_VALUES.includes(categoryRaw)
    ? (categoryRaw as Category)
    : null;

  const normalizedQuery = q ? truncateText(sanitizeText(q).replace(/\s+/g, " "), 200) || null : null;
  const listingType = type === "IN_STOCK" || type === "MADE_TO_ORDER" ? (type as ListingType) : null;
  const normalizedTags = normalizeSavedSearchTags(tags);
  const normalizedMin = typeof minPrice === "number" && Number.isFinite(minPrice) ? minPrice : null;
  const normalizedMax = typeof maxPrice === "number" && Number.isFinite(maxPrice) ? maxPrice : null;
  const normalizedShips = typeof shipsWithinDays === "number" && Number.isFinite(shipsWithinDays) ? shipsWithinDays : null;
  const normalizedRating = typeof minRating === "number" && Number.isFinite(minRating) ? minRating : null;
  const normalizedLat = typeof lat === "number" && Number.isFinite(lat) ? Number(lat.toFixed(5)) : null;
  const normalizedLng = typeof lng === "number" && Number.isFinite(lng) ? Number(lng.toFixed(5)) : null;
  const normalizedRadius = typeof radiusMiles === "number" && Number.isFinite(radiusMiles) ? radiusMiles : null;
  const normalizedSort = sort ?? null;

  if (normalizedMin !== null && normalizedMax !== null && normalizedMin > normalizedMax) {
    return privateJson({ error: "Minimum price cannot exceed maximum price" }, { status: 400 });
  }
  if ((normalizedLat === null) !== (normalizedLng === null) || ((normalizedLat !== null || normalizedLng !== null) && normalizedRadius === null)) {
    return privateJson({ error: "Location searches require latitude, longitude, and radius" }, { status: 400 });
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
    return privateJson({ error: "Choose at least one search term or filter before saving." }, { status: 400 });
  }

  const criteria: OwnerSavedSearchCriteria = {
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
  };

  const result = await withSerializableDbUserContext(me.id, async (tx) => {
    const existing = await findDuplicateOwnerSavedSearch(me.id, criteria, tx);
    if (existing) return { id: existing.id, existing: true };

    const count = await countOwnerSavedSearches(me.id, tx);
    if (count >= 25) return { error: "limit" as const };

    const saved = await createOwnerSavedSearch(me.id, criteria, tx);
    return { id: saved.id, existing: false };
  });

  if ("error" in result) {
    return privateJson({ error: "You can save up to 25 searches. Delete one before saving another." }, { status: 400 });
  }

  return privateJson({ ok: true, id: result.id, existing: result.existing });
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });
  const { success, reset } = await safeRateLimit(savedSearchRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many saved-search actions."));

  const userResult = await getDbUserResult();
  if (userResult.response) return userResult.response;
  const me = userResult.me;
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const searches = await listOwnerSavedSearches(me.id, prisma);

  return privateJson({
    searches: searches.map((search) => ({
      ...search,
      lat: savedSearchCoordinateForTransport(search.lat),
      lng: savedSearchCoordinateForTransport(search.lng),
    })),
  });
}

export async function DELETE(req: NextRequest) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });
  const { success, reset } = await safeRateLimit(savedSearchRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many saved-search actions."));

  const userResult = await getDbUserResult();
  if (userResult.response) return userResult.response;
  const me = userResult.me;
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return privateJson({ error: "Missing id" }, { status: 400 });

  await deleteOwnerSavedSearch(me.id, id, prisma);
  return privateJson({ ok: true });
}
