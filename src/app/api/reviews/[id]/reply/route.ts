// src/app/api/reviews/[id]/reply/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sanitizeRichText } from "@/lib/sanitize";
import { containsProfanity } from "@/lib/profanity";
import { rateLimitResponse, reviewRatelimit, safeRateLimit } from "@/lib/ratelimit";

const ReplySchema = z.object({
  text: z.string().min(1).max(2000),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params; // review id
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(reviewRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many review replies.");

  let replyParsed;
  try {
    replyParsed = ReplySchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const rawBody = replyParsed.text.trim().slice(0, 2000);
  const body = sanitizeRichText(rawBody);
  if (!body) return NextResponse.json({ error: "Empty reply" }, { status: 400 });

  // Profanity check (log-only — does not block submission)
  {
    const profanityResult = containsProfanity(body);
    if (profanityResult.flagged) {
      console.error(`[PROFANITY] Seller review reply flagged — matches: ${profanityResult.matches.join(", ")}`);
    }
  }

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
