// POST { type: string, enabled: boolean }
// Auth required
// Updates user.notificationPreferences JSON field
import { auth } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { isValidEmailPreferenceKey, VALID_PREFERENCE_KEYS } from "@/lib/notificationPreferenceKeys";
import { notificationPreferenceRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { clearOneClickEmailSuppression } from "@/lib/emailSuppression";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";

const PreferencesSchema = z.object({
  type: z.enum(VALID_PREFERENCE_KEYS),
  enabled: z.boolean(),
});
const NOTIFICATION_PREFERENCE_BODY_MAX_BYTES = 8 * 1024;

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });
  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }
  const { success, reset } = await safeRateLimit(notificationPreferenceRatelimit, me.id);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many notification preference changes."));

  let body;
  try {
    body = PreferencesSchema.parse(await readBoundedJson(request, NOTIFICATION_PREFERENCE_BODY_MAX_BYTES));
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return privateJson({ error: "Request body too large" }, { status: 413 });
    }
    if (isInvalidJsonBodyError(e)) {
      return privateJson({ error: "Invalid JSON" }, { status: 400 });
    }
    if (e instanceof z.ZodError) {
      return privateJson({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    throw e;
  }
  const { type, enabled } = body;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE "User"
      SET "notificationPreferences" = jsonb_set(
        COALESCE("notificationPreferences", '{}'::jsonb),
        ARRAY[${type}]::text[],
        to_jsonb(${enabled}::boolean),
        true
      )
      WHERE "id" = ${me.id}
    `;

    if (enabled && isValidEmailPreferenceKey(type)) {
      await tx.$executeRaw`
        UPDATE "User"
        SET "emailPreferenceOptInAt" = ${new Date()}
        WHERE "id" = ${me.id}
      `;
      await clearOneClickEmailSuppression(me.email, tx);
    }
  });

  return privateJson({ ok: true });
}
