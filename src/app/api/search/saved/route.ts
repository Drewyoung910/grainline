import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Category } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { z } from "zod";

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
  return prisma.user.findUnique({ where: { clerkId: userId } });
}

export async function POST(req: NextRequest) {
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

  const saved = await prisma.savedSearch.create({
    data: {
      userId: me.id,
      query: q?.trim() || null,
      category: categoryVal,
      minPrice: Number.isFinite(minPrice) ? minPrice : null,
      maxPrice: Number.isFinite(maxPrice) ? maxPrice : null,
      tags: tags?.filter(Boolean) ?? [],
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
