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
import { userClerkGate } from "@/lib/userIdentityAccess";

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

  const me = await userClerkGate(prisma, userId);
  if (!me) return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
  if (me.banned || me.deletedAt) {
    return privateJson({ error: "Account is suspended" }, { status: HTTP_STATUS.FORBIDDEN });
  }

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
              userId: true,
              ownerAccountActive: true,
            },
          },
        },
      },
    },
  });
  if (!review) return privateJson({ error: "Not found" }, { status: HTTP_STATUS.NOT_FOUND });

  if (review.listing.seller.userId !== me.id) {
    return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
  }
  if (review.listing.seller.ownerAccountActive !== true) {
    return privateJson({ error: "Account is suspended" }, { status: HTTP_STATUS.FORBIDDEN });
  }

  if (review.sellerReply) {
    // one reply; edit by seller could be added later
    return privateJson({ error: "Reply already posted" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  // Recheck current ownership/activity and the one-reply condition in the
  // write itself. Concurrent submits cannot overwrite a reply already saved.
  const result = await prisma.review.updateMany({
    where: {
      id,
      sellerReply: null,
      listing: { seller: { userId: me.id, ownerAccountActive: true } },
    },
    data: { sellerReply: body, sellerReplyAt: new Date() },
  });
  if (result.count !== 1) {
    return privateJson({ error: "Review reply is no longer available." }, { status: HTTP_STATUS.CONFLICT });
  }

  return privateJson({ ok: true });
}
