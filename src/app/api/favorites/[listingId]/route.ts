import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { rateLimitResponse, safeRateLimit, saveRatelimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { logServerError } from "@/lib/serverErrorLogger";

type Params = { listingId: string };

export async function DELETE(_req: Request, ctx: { params: Promise<Params> }) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success: rlOk, reset } = await safeRateLimit(saveRatelimit, userId);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "Too many save actions."));

  const { listingId } = await ctx.params;
  if (!listingId) return privateJson({ error: "listingId required" }, { status: 400 });

  let me;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  try {
    await prisma.favorite.deleteMany({ where: { userId: me.id, listingId } });
  } catch (error) {
    logServerError(error, {
      source: "favorite_delete",
      extra: { userId: me.id, listingId },
    });
    return privateJson({ error: "Could not remove saved item." }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }

  return privateJson({ ok: true });
}
