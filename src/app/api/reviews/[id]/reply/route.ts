// src/app/api/reviews/[id]/reply/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params; // review id
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { text } = (await req.json()) as { text: string };
  const body = (text ?? "").trim().slice(0, 2000);
  if (!body) return NextResponse.json({ error: "Empty reply" }, { status: 400 });

  // Find review + ensure current user owns the shop/listing
  const review = await prisma.review.findUnique({
    where: { id },
    include: {
      listing: { include: { seller: { include: { user: true } } } },
    },
  });
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sellerUserId = review.listing.seller.user.clerkId;
  if (sellerUserId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (review.sellerReply) {
    // one reply; edit by seller could be added later
    return NextResponse.json({ error: "Reply already posted" }, { status: 400 });
  }

  await prisma.review.update({
    where: { id },
    data: { sellerReply: body, sellerReplyAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
