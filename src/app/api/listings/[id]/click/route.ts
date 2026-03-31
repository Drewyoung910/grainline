import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { clickRatelimit, getIP } from "@/lib/ratelimit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { success } = await clickRatelimit.limit(getIP(req));
  if (!success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const { id } = await params;
  const cookieStore = await cookies();
  const cookieName = `clicked_${id}`;

  if (cookieStore.get(cookieName)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const listing = await prisma.listing.findUnique({ where: { id }, select: { sellerId: true } });
  await prisma.listing.updateMany({ where: { id }, data: { clickCount: { increment: 1 } } });

  if (listing) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    prisma.listingViewDaily.upsert({
      where: { listingId_date: { listingId: id, date: today } },
      create: { listingId: id, sellerProfileId: listing.sellerId, date: today, views: 0, clicks: 1 },
      update: { clicks: { increment: 1 } },
    }).catch(() => {});
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(cookieName, "1", {
    maxAge: 60 * 60 * 24,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return res;
}
