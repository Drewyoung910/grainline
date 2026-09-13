import { auth, clerkClient, reverificationErrorResponse } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { ensureUser } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { prisma } from "@/lib/db";
import {
  acquireAccountDeletionLock,
  anonymizeUserAccount,
  getAccountDeletionBlockers,
  releaseAccountDeletionLock,
} from "@/lib/accountDeletion";
import { enqueueAccountDeletionLocalAnonymizeSideEffect } from "@/lib/accountDeletionSideEffects";
import { accountDeletionRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { getExplicitCrossOriginPostRejection } from "@/lib/requestOriginGuard";
import {
  ACCOUNT_DELETION_REVERIFICATION,
  hasFreshAccountDeletionSession,
} from "@/lib/accountExportReverification";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";

const AccountDeletionSchema = z.object({
  confirmText: z.literal("DELETE"),
});
const ACCOUNT_DELETION_BODY_MAX_BYTES = 4 * 1024;

export async function POST(req: Request) {
  const crossOriginRejection = getExplicitCrossOriginPostRejection(req);
  if (crossOriginRejection) {
    return privateJson(
      { error: "Cross-origin account deletion requests are not allowed." },
      { status: HTTP_STATUS.FORBIDDEN },
    );
  }

  const session = await auth();
  const clerkId = session.userId;
  if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  if (!hasFreshAccountDeletionSession(session.factorVerificationAge)) {
    return privateResponse(reverificationErrorResponse(ACCOUNT_DELETION_REVERIFICATION));
  }

  try {
    AccountDeletionSchema.parse(await readBoundedJson(req, ACCOUNT_DELETION_BODY_MAX_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return privateJson(
        { error: "Request body too large" },
        { status: HTTP_STATUS.PAYLOAD_TOO_LARGE },
      );
    }
    if (isInvalidJsonBodyError(error)) {
      return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    if (error instanceof z.ZodError) {
      return privateJson(
        { error: "Type DELETE to confirm account deletion." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    throw error;
  }

  let me: Awaited<ReturnType<typeof ensureUser>>;
  try {
    me = await ensureUser();
  } catch (error) {
    const accountResponse = accountAccessErrorResponse(error);
    if (accountResponse) return accountResponse;
    throw error;
  }
  if (!me) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  const { success, reset } = await safeRateLimit(accountDeletionRatelimit, me.id);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many account deletion attempts."));

  const blockers = await getAccountDeletionBlockers(me.id);
  if (blockers.length > 0) {
    return privateJson(
      { error: "Account deletion is blocked by open obligations.", blockers },
      { status: HTTP_STATUS.CONFLICT },
    );
  }

  const deletionLock = await acquireAccountDeletionLock(me.id);
  if (!deletionLock) {
    return privateJson({
      error: "Account deletion is already in progress. Please wait a moment.",
    }, { status: HTTP_STATUS.CONFLICT });
  }

  try {
    await (await clerkClient()).users.deleteUser(clerkId);
  } catch (error) {
    await releaseAccountDeletionLock(deletionLock);
    Sentry.captureException(error, { tags: { source: "account_delete_clerk" }, extra: { dbUserId: me.id } });
    return privateJson({
      error: "Account deletion is temporarily unavailable. Please try again.",
    }, { status: HTTP_STATUS.SERVICE_UNAVAILABLE });
  }

  try {
    await enqueueAccountDeletionLocalAnonymizeSideEffect(prisma, me.id);
    const anonymized = await anonymizeUserAccount(me.id, { lockAlreadyAcquired: true });
    if ("inProgress" in anonymized && anonymized.inProgress) {
      return privateJson({
        error: "Account deletion is already in progress. Please wait a moment.",
        clerkSessionDeleted: true,
      }, { status: HTTP_STATUS.CONFLICT });
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "account_delete_anonymize" }, extra: { dbUserId: me.id } });
    return privateJson({
      error: "Your sign-in was deleted, but account data anonymization needs manual support follow-up.",
      clerkSessionDeleted: true,
    }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }

  return privateJson({ ok: true });
}
