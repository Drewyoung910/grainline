// src/app/api/favorites/route.ts
import { auth } from "@clerk/nextjs/server";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { createNotification } from "@/lib/notifications";
import { saveRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { publicListingPath } from "@/lib/publicPaths";
import {
  addOwnerFavorite,
  FAVORITE_LISTING_ID_PATTERN,
} from "@/lib/favoriteAccess";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { logServerError } from "@/lib/serverErrorLogger";
import { z } from "zod";

const FavoriteSchema = z.object({
  listingId: z.string().regex(FAVORITE_LISTING_ID_PATTERN),
});
const FAVORITE_BODY_MAX_BYTES = 8 * 1024;

export async function POST(req: Request) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson({ error: "Forbidden" }, { status: HTTP_STATUS.FORBIDDEN });
  }

  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const { success: rlOk, reset } = await safeRateLimit(saveRatelimit, userId);
  if (!rlOk) return privateResponse(rateLimitResponse(reset, "Too many save actions."));

  let listingId: string;
  try {
    const parsed = FavoriteSchema.parse(await readBoundedJson(req, FAVORITE_BODY_MAX_BYTES));
    listingId = parsed.listingId;
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

  let me;
  try {
    me = await ensureUser();
  } catch (e) {
    const accountResponse = accountAccessErrorResponse(e);
    if (accountResponse) return accountResponse;

    logServerError(e, {
      source: "favorite_ensure_user",
      level: "warning",
    });
    return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  }
  if (!me) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  let favorite;
  try {
    favorite = await addOwnerFavorite(me.id, listingId);
  } catch (e) {
    logServerError(e, {
      source: "favorite_add",
      extra: { listingId, dbUserId: me.id },
    });
    return privateJson({ error: "DB error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
  if (favorite.resultStatus === "NOT_FOUND") {
    return privateJson({ error: "Listing not found." }, { status: HTTP_STATUS.NOT_FOUND });
  }
  if (favorite.resultStatus === "SELF") {
    return privateJson({ error: "Cannot favorite your own listing." }, { status: HTTP_STATUS.BAD_REQUEST });
  }
  if (favorite.resultStatus === "BLOCKED") {
    return privateJson({ error: "Blocked" }, { status: HTTP_STATUS.FORBIDDEN });
  }

  // Notify listing owner (non-fatal; createNotification handles exact duplicate suppression)
  try {
    const ownerUserId = favorite.ownerUserId;
    if (ownerUserId && ownerUserId !== me.id) {
      const favName = me.name ?? "Someone";
      await createNotification({
        userId: ownerUserId,
        type: "NEW_FAVORITE",
        title: `${favName} hearted your listing`,
        body: favorite.title ?? "Saved listing",
        link: publicListingPath(listingId, favorite.title ?? undefined),
        dedupScope: me.id,
        relatedUserId: me.id,
        sourceType: NOTIFICATION_SOURCE_TYPES.FAVORITE,
        sourceId: listingId,
      });
    }
  } catch (e) {
    logServerError(e, {
      source: "favorite_notification",
      level: "warning",
      extra: { listingId, dbUserId: me.id, sellerUserId: favorite.ownerUserId },
    });
  }

  return privateJson({ ok: true });
}
