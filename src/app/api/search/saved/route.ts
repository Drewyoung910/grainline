import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Category } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";

async function getDbUser() {
  const { userId } = await auth();
  if (!userId) return null;
  return prisma.user.findUnique({ where: { clerkId: userId } });
}

export async function POST(req: NextRequest) {
  const me = await getDbUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { q, category, minPrice, maxPrice, tags } = body as {
    q?: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    tags?: string[];
  };

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
      tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
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
