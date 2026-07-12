import { auth } from "@clerk/nextjs/server";
import { markReadRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { markOwnerNotificationsRead } from "@/lib/notificationOwnerAccess";
import { isRequestBodyTooLargeError, readOptionalBoundedJson } from "@/lib/requestBody";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";

export const runtime = "nodejs";
const NOTIFICATION_READ_ALL_BODY_MAX_BYTES = 16 * 1024;

export async function POST(req: Request) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: 403 });
  }

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

  let body: unknown;
  try {
    body = await readOptionalBoundedJson(req, NOTIFICATION_READ_ALL_BODY_MAX_BYTES, {});
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson({ error: "Request body too large" }, { status: 413 });
    }
    throw error;
  }
  const bodyObject = body as { ids?: unknown };
  const rawIds = Array.isArray(bodyObject.ids)
    ? bodyObject.ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  const ids = Array.from(new Set(rawIds)).slice(0, 100);

  const updated = await markOwnerNotificationsRead(me.id, ids);

  return privateJson({
    ok: true,
    markedCount: updated.count,
    cappedIds: rawIds.length > ids.length,
  });
}
