import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const cookieName = `viewed_${id}`;

  if (cookieStore.get(cookieName)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  await prisma.listing.updateMany({ where: { id }, data: { viewCount: { increment: 1 } } });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName, "1", {
    maxAge: 60 * 60 * 24,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
