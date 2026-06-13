import { auth, clerkClient } from "@clerk/nextjs/server";
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

export async function POST() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

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
