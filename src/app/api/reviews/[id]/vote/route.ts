import { auth } from "@clerk/nextjs/server";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { rateLimitResponse, reviewVoteRatelimit, safeRateLimit } from "@/lib/ratelimit";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { isReviewVoteId, toggleOwnerReviewVote } from "@/lib/reviewVoteAccess";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await ctx.params; // review id
  if (!isReviewVoteId(id)) return privateJson({ error: "Not found" }, { status: 404 });
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(reviewVoteRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many review votes."));

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const updated = await toggleOwnerReviewVote(me.id, id);
  if (updated.resultStatus === "NOT_FOUND") {
    return privateJson({ error: "Not found" }, { status: 404 });
  }
  if (updated.resultStatus === "SELF") {
    return privateJson({ error: "Cannot vote own review" }, { status: 400 });
  }
  if (updated.resultStatus === "OWN_LISTING") {
    return privateJson({ error: "Cannot vote on your own listing" }, { status: 400 });
  }

  return privateJson({ ok: true, helpfulCount: updated.helpfulCount, voted: updated.voted });
}
