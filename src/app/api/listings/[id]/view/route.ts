import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { viewRatelimit, profileViewRatelimit, getIP } from "@/lib/ratelimit";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ip = getIP(req);
  const { success: globalOk } = await viewRatelimit.limit(ip);
  if (!globalOk) return NextResponse.json({ ok: true }); // silent drop

  const { id } = await params;

  // Per-IP+listing dedup (24h) — silently skip if already counted
  const { success: dedupOk } = await profileViewRatelimit.limit(`${ip}:${id}`);
  if (!dedupOk) return NextResponse.json({ ok: true, skipped: true });

  const cookieStore = await cookies();
  const cookieName = `viewed_${id}`;

  if (cookieStore.get(cookieName)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const listing = await prisma.listing.findUnique({ where: { id }, select: { sellerId: true } });
  await prisma.listing.updateMany({ where: { id }, data: { viewCount: { increment: 1 } } });

  if (listing) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    prisma.listingViewDaily.upsert({
      where: { listingId_date: { listingId: id, date: today } },
      create: { listingId: id, sellerProfileId: listing.sellerId, date: today, views: 1, clicks: 0 },
      update: { views: { increment: 1 } },
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
