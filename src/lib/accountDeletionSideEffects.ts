import { createHash } from "crypto";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { deleteR2ObjectByUrl } from "@/lib/r2";

export const ACCOUNT_DELETION_SIDE_EFFECT_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  DONE: "DONE",
  FAILED: "FAILED",
} as const;
export const ACCOUNT_DELETION_SIDE_EFFECT_STALE_PROCESSING_MS = 60 * 60 * 1000;

export const ACCOUNT_DELETION_SIDE_EFFECT_KIND = {
  LOCAL_ANONYMIZE: "LOCAL_ANONYMIZE",
  STRIPE_REJECT: "STRIPE_REJECT",
  MEDIA_DELETE: "MEDIA_DELETE",
  AUDIT_REDACT: "AUDIT_REDACT",
} as const;

type AccountDeletionSideEffectKind =
  (typeof ACCOUNT_DELETION_SIDE_EFFECT_KIND)[keyof typeof ACCOUNT_DELETION_SIDE_EFFECT_KIND];

type AccountDeletionSideEffectDb = Pick<Prisma.TransactionClient, "accountDeletionSideEffect">;

export type AccountDeletionAuditRedactionUpdate = {
  logId: string;
  metadata?: Prisma.JsonValue;
  reason?: string;
};

function hashDedupPart(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function sanitizeSideEffectError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/acct_[A-Za-z0-9_]+/g, "[stripe-account]")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, "[email]")
    .slice(0, 1000);
}

function nextAttemptAt(attempts: number, now = new Date()) {
  const minutes = Math.min(60, Math.max(5, 2 ** Math.min(attempts, 5)));
  return new Date(now.getTime() + minutes * 60 * 1000);
}

function staleProcessingBefore(now = new Date()) {
  return new Date(now.getTime() - ACCOUNT_DELETION_SIDE_EFFECT_STALE_PROCESSING_MS);
}

function claimableAccountDeletionSideEffectWhere(now = new Date()): Prisma.AccountDeletionSideEffectWhereInput {
  return {
    OR: [
      {
        status: {
          in: [
            ACCOUNT_DELETION_SIDE_EFFECT_STATUS.PENDING,
            ACCOUNT_DELETION_SIDE_EFFECT_STATUS.FAILED,
          ],
        },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      {
        status: ACCOUNT_DELETION_SIDE_EFFECT_STATUS.PROCESSING,
        updatedAt: { lt: staleProcessingBefore(now) },
      },
    ],
  };
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function enqueueAccountDeletionSideEffect(
  db: AccountDeletionSideEffectDb,
  input: {
    userId: string;
    kind: AccountDeletionSideEffectKind;
    dedupKey: string;
    payload?: Prisma.InputJsonValue;
  },
) {
  try {
    await db.accountDeletionSideEffect.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        dedupKey: input.dedupKey,
        payload: input.payload ?? {},
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

export function accountDeletionLocalAnonymizeDedupKey(userId: string) {
  return `account-delete:local:${userId}`;
}

export function accountDeletionStripeRejectDedupKey(userId: string, stripeAccountId: string) {
  return `account-delete:stripe:${userId}:${hashDedupPart(stripeAccountId)}`;
}

export function accountDeletionMediaDeleteDedupKey(userId: string, url: string) {
  return `account-delete:media:${userId}:${hashDedupPart(url)}`;
}

export function accountDeletionAuditRedactDedupKey(userId: string, logId: string) {
  return `account-delete:audit:${userId}:${logId}`;
}

export async function enqueueAccountDeletionLocalAnonymizeSideEffect(
  db: AccountDeletionSideEffectDb,
  userId: string,
) {
  await enqueueAccountDeletionSideEffect(db, {
    userId,
    kind: ACCOUNT_DELETION_SIDE_EFFECT_KIND.LOCAL_ANONYMIZE,
    dedupKey: accountDeletionLocalAnonymizeDedupKey(userId),
  });
}

export async function markAccountDeletionLocalAnonymizeDone(
  db: AccountDeletionSideEffectDb,
  userId: string,
) {
  await db.accountDeletionSideEffect.updateMany({
    where: { dedupKey: accountDeletionLocalAnonymizeDedupKey(userId) },
    data: {
      status: ACCOUNT_DELETION_SIDE_EFFECT_STATUS.DONE,
      processedAt: new Date(),
      nextAttemptAt: null,
      lastError: null,
      payload: {},
    },
  });
}

export async function enqueueAccountDeletionMediaDeleteSideEffects(
  db: AccountDeletionSideEffectDb,
  userId: string,
  urls: string[],
) {
  if (urls.length === 0) return;
  await db.accountDeletionSideEffect.createMany({
    data: urls.map((url) => ({
      userId,
      kind: ACCOUNT_DELETION_SIDE_EFFECT_KIND.MEDIA_DELETE,
      dedupKey: accountDeletionMediaDeleteDedupKey(userId, url),
      payload: { url },
    })),
    skipDuplicates: true,
  });
}

export async function enqueueAccountDeletionAuditRedactionSideEffects(
  db: AccountDeletionSideEffectDb,
  userId: string,
  updates: AccountDeletionAuditRedactionUpdate[],
) {
  if (updates.length === 0) return;
  await db.accountDeletionSideEffect.createMany({
    data: updates.map((update) => ({
      userId,
      kind: ACCOUNT_DELETION_SIDE_EFFECT_KIND.AUDIT_REDACT,
      dedupKey: accountDeletionAuditRedactDedupKey(userId, update.logId),
      payload: {
        logId: update.logId,
        ...(update.metadata !== undefined ? { metadata: update.metadata } : {}),
        ...(update.reason !== undefined ? { reason: update.reason } : {}),
      } as Prisma.InputJsonObject,
    })),
    skipDuplicates: true,
  });
}

export async function runAccountDeletionStripeRejectSideEffect(input: {
  userId: string;
  stripeAccountId: string;
  stripeAccountVersion: string | null;
  stripeControllerType: string | null;
}) {
  const dedupKey = accountDeletionStripeRejectDedupKey(input.userId, input.stripeAccountId);
  await enqueueAccountDeletionSideEffect(prisma, {
    userId: input.userId,
    kind: ACCOUNT_DELETION_SIDE_EFFECT_KIND.STRIPE_REJECT,
    dedupKey,
    payload: {
      stripeAccountId: input.stripeAccountId,
      stripeAccountVersion: input.stripeAccountVersion,
      stripeControllerType: input.stripeControllerType,
    },
  });
  return processAccountDeletionSideEffectByDedupKey(dedupKey);
}

function payloadObject(payload: Prisma.JsonValue): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

async function performAccountDeletionSideEffect(effect: {
  id: string;
  userId: string;
  kind: string;
  payload: Prisma.JsonValue;
}) {
  const payload = payloadObject(effect.payload);

  if (effect.kind === ACCOUNT_DELETION_SIDE_EFFECT_KIND.LOCAL_ANONYMIZE) {
    const { anonymizeUserAccount } = await import("@/lib/accountDeletion");
    const result = await anonymizeUserAccount(effect.userId);
    if ("inProgress" in result && result.inProgress) {
      throw new Error("Account deletion anonymization is already in progress");
    }
    if (!result.ok) throw new Error("Account deletion anonymization did not complete");
    return;
  }

  if (effect.kind === ACCOUNT_DELETION_SIDE_EFFECT_KIND.STRIPE_REJECT) {
    if (typeof payload.stripeAccountId !== "string") {
      throw new Error("Missing Stripe account id for account deletion side effect");
    }
    await stripe.accounts.reject(payload.stripeAccountId, { reason: "other" });
    await prisma.sellerProfile.updateMany({
      where: {
        userId: effect.userId,
        manualStripeReconciliationNeeded: true,
        manualStripeReconciliationNote: {
          startsWith: "Account deletion could not reject Stripe Connect account",
        },
      },
      data: {
        manualStripeReconciliationNeeded: false,
        manualStripeReconciliationNote: null,
      },
    });
    return;
  }

  if (effect.kind === ACCOUNT_DELETION_SIDE_EFFECT_KIND.MEDIA_DELETE) {
    if (typeof payload.url !== "string") {
      throw new Error("Missing media URL for account deletion side effect");
    }
    const deleted = await deleteR2ObjectByUrl(payload.url);
    if (!deleted) throw new Error("Account deletion media URL was not deleted");
    return;
  }

  if (effect.kind === ACCOUNT_DELETION_SIDE_EFFECT_KIND.AUDIT_REDACT) {
    if (typeof payload.logId !== "string") {
      throw new Error("Missing audit log id for account deletion side effect");
    }
    const data: Prisma.AdminAuditLogUpdateInput = {
      ...(payload.metadata !== undefined ? { metadata: payload.metadata as Prisma.InputJsonValue } : {}),
      ...(typeof payload.reason === "string" ? { reason: payload.reason } : {}),
    };
    if (Object.keys(data).length === 0) return;
    await prisma.adminAuditLog.update({ where: { id: payload.logId }, data });
    return;
  }

  throw new Error(`Unknown account deletion side effect kind: ${effect.kind}`);
}

export async function processAccountDeletionSideEffectByDedupKey(dedupKey: string) {
  const effect = await prisma.accountDeletionSideEffect.findUnique({
    where: { dedupKey },
    select: { id: true },
  });
  if (!effect) return true;
  return processAccountDeletionSideEffect(effect.id);
}

export async function processAccountDeletionSideEffect(id: string) {
  const now = new Date();
  const claimed = await prisma.accountDeletionSideEffect.updateMany({
    where: {
      id,
      ...claimableAccountDeletionSideEffectWhere(now),
    },
    data: {
      status: ACCOUNT_DELETION_SIDE_EFFECT_STATUS.PROCESSING,
      attempts: { increment: 1 },
      lastError: null,
    },
  });

  if (claimed.count !== 1) {
    const current = await prisma.accountDeletionSideEffect.findUnique({
      where: { id },
      select: { status: true },
    });
    return current?.status === ACCOUNT_DELETION_SIDE_EFFECT_STATUS.DONE;
  }

  const effect = await prisma.accountDeletionSideEffect.findUniqueOrThrow({
    where: { id },
    select: { id: true, userId: true, kind: true, payload: true, attempts: true },
  });

  try {
    await performAccountDeletionSideEffect(effect);
    await prisma.accountDeletionSideEffect.update({
      where: { id },
      data: {
        status: ACCOUNT_DELETION_SIDE_EFFECT_STATUS.DONE,
        processedAt: new Date(),
        nextAttemptAt: null,
        lastError: null,
        payload: {},
      },
    });
    return true;
  } catch (error) {
    const lastError = sanitizeSideEffectError(error);
    await prisma.accountDeletionSideEffect.update({
      where: { id },
      data: {
        status: ACCOUNT_DELETION_SIDE_EFFECT_STATUS.FAILED,
        nextAttemptAt: nextAttemptAt(effect.attempts),
        lastError,
      },
    });
    Sentry.captureException(error, {
      tags: { source: "account_delete_side_effect", kind: effect.kind },
      extra: { userId: effect.userId, sideEffectId: effect.id },
    });
    return false;
  }
}

export async function processAccountDeletionSideEffectsForUser(
  userId: string,
  kinds: AccountDeletionSideEffectKind[],
) {
  const effects = await prisma.accountDeletionSideEffect.findMany({
    where: {
      userId,
      kind: { in: kinds },
      ...claimableAccountDeletionSideEffectWhere(new Date()),
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: { id: true },
  });

  let processed = 0;
  let failed = 0;
  for (const effect of effects) {
    if (await processAccountDeletionSideEffect(effect.id)) processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}

export async function processAccountDeletionSideEffectBatch({ take = 20 } = {}) {
  const effects = await prisma.accountDeletionSideEffect.findMany({
    where: {
      ...claimableAccountDeletionSideEffectWhere(new Date()),
    },
    orderBy: { createdAt: "asc" },
    take,
    select: { id: true },
  });

  let processed = 0;
  let failed = 0;
  for (const effect of effects) {
    if (await processAccountDeletionSideEffect(effect.id)) processed += 1;
    else failed += 1;
  }
  return { processed, failed, total: effects.length };
}
