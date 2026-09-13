import { auth } from "@clerk/nextjs/server";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { markOwnerNotificationRead } from "@/lib/notificationOwnerAccess";
import { markReadRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(markReadRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many notification updates."));

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  await markOwnerNotificationRead(me.id, id);

  return privateJson({ ok: true });
}
