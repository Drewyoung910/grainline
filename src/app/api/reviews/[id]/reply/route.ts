import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sanitizeRichText, truncateText } from "@/lib/sanitize";
import { containsProfanity } from "@/lib/profanity";
import { captureProfanityFlag } from "@/lib/profanityTelemetry";
import { rateLimitResponse, reviewRatelimit, safeRateLimit } from "@/lib/ratelimit";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";

const ReplySchema = z.object({
  text: z.string().min(1).max(2000),
});
const REVIEW_REPLY_BODY_MAX_BYTES = 24 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params; // review id
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const { success, reset } = await safeRateLimit(reviewRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many review replies."));

  let replyParsed;
  try {
    replyParsed = ReplySchema.parse(await readBoundedJson(req, REVIEW_REPLY_BODY_MAX_BYTES));
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    if (isInvalidJsonBodyError(e)) {
      return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    if (e instanceof z.ZodError) {
      return privateJson({ error: "Invalid input", details: e.issues }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    throw e;
  }
  const rawBody = truncateText(replyParsed.text.trim(), 2000);
  const body = sanitizeRichText(rawBody);
  if (!body) return privateJson({ error: "Empty reply" }, { status: HTTP_STATUS.BAD_REQUEST });

  // Profanity check (log-only — does not block submission)
  {
    const profanityResult = containsProfanity(body);
    if (profanityResult.flagged) {
      captureProfanityFlag({
        source: "review_reply",
        matchCount: profanityResult.matches.length,
        extra: { reviewId: id },
      });
    }
  }

  // Find review + ensure current user owns the shop/listing
  const review = await prisma.review.findUnique({
    where: { id },
    select: {
      sellerReply: true,
      listing: {
        select: {
          seller: {
            select: {
              user: { select: { clerkId: true, banned: true, deletedAt: true } },
            },
          },
        },
      },
    },
  });
  if (!review) return privateJson({ error: "Not found" }, { status: HTTP_STATUS.NOT_FOUND });

  const sellerUserId = review.listing.seller.user.clerkId;
  if (sellerUserId !== userId) {
    return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
  }
  if (review.listing.seller.user.banned || review.listing.seller.user.deletedAt) {
    return privateJson({ error: "Account is suspended" }, { status: HTTP_STATUS.FORBIDDEN });
  }

  if (review.sellerReply) {
    // one reply; edit by seller could be added later
    return privateJson({ error: "Reply already posted" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  await prisma.review.update({
    where: { id },
    data: { sellerReply: body, sellerReplyAt: new Date() },
  });

  return privateJson({ ok: true });
}
