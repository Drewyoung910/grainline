import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Category } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { z } from "zod";
import { ensureUser } from "@/lib/ensureUser";
import { rateLimitResponse, safeRateLimit, savedSearchRatelimit } from "@/lib/ratelimit";

const SavedSearchSchema = z.object({
  q: z.string().max(200).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
  minPrice: z.number().min(0).max(100000).optional().nullable(),
  maxPrice: z.number().min(0).max(100000).optional().nullable(),
  tags: z.array(z.string().min(1).max(100)).max(20).optional(),
});

async function getDbUser() {
  const { userId } = await auth();
  if (!userId) return null;
  return ensureUser();
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { success, reset } = await safeRateLimit(savedSearchRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many saved-search actions.");

  const me = await getDbUser();
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
  const { q, category, minPrice, maxPrice, tags } = searchParsed;

  const categoryRaw = (category ?? "").toUpperCase();
  const categoryVal: Category | null = CATEGORY_VALUES.includes(categoryRaw)
    ? (categoryRaw as Category)
    : null;

  const normalizedQuery = q?.trim().replace(/\s+/g, " ").slice(0, 200) || null;
  const normalizedTags = Array.from(new Set(
    (tags ?? [])
      .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean)
  )).slice(0, 20);
  const normalizedMin = typeof minPrice === "number" && Number.isFinite(minPrice) ? minPrice : null;
  const normalizedMax = typeof maxPrice === "number" && Number.isFinite(maxPrice) ? maxPrice : null;

  if (normalizedMin !== null && normalizedMax !== null && normalizedMin > normalizedMax) {
    return NextResponse.json({ error: "Minimum price cannot exceed maximum price" }, { status: 400 });
  }

  const existing = await prisma.savedSearch.findFirst({
    where: {
      userId: me.id,
      query: normalizedQuery,
      category: categoryVal,
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
      minPrice: normalizedMin,
      maxPrice: normalizedMax,
      tags: normalizedTags,
    },
  });

  return NextResponse.json({ ok: true, id: saved.id });
}

export async function GET() {
  const me = await getDbUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const searches = await prisma.savedSearch.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ searches });
}

export async function DELETE(req: NextRequest) {
  const me = await getDbUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.savedSearch.deleteMany({ where: { id, userId: me.id } });
  return NextResponse.json({ ok: true });
}
