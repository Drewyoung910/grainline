import { createHash } from "crypto";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { deleteR2ObjectByKey, deleteR2ObjectByUrl } from "@/lib/r2";
import { runBoundedDeletionBatches } from "@/lib/cronBatchState";
import { getAccountDeletionSideEffectClient } from "@/lib/accountDeletionSideEffectDb";
import { accountDeletionMediaKeyBatches } from "@/lib/urlValidation";
import {
  ACCOUNT_DELETION_SIDE_EFFECT_DONE_RETENTION_BATCH_SIZE,
  ACCOUNT_DELETION_SIDE_EFFECT_DONE_RETENTION_TIME_BUDGET_MS,
  accountDeletionSideEffectDoneRetentionCutoff,
} from "@/lib/accountDeletionSideEffectRetentionState";
import { clearSellerAccountDeletionReconciliation } from "@/lib/sellerAccountDeletionPrivateAccess";

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

type AccountDeletionSideEffectDb = Pick<
  Prisma.TransactionClient,
  "accountDeletionSideEffect" | "$queryRaw"
>;

type AccountDeletionSideEffectClaim = {
  id: string;
  userId: string;
  kind: string;
  payload: Prisma.JsonValue;
  attempts: number;
  claimGeneration: bigint;
  claimToken: string;
};

type AccountDeletionSideEffectClaimResult =
  | { action: "process"; effect: AccountDeletionSideEffectClaim }
  | { action: "done" | "missing" | "unavailable" };

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
        OR: [
          {
            processingStartedAt: {
              lt: new Date(now.getTime() - ACCOUNT_DELETION_SIDE_EFFECT_STALE_PROCESSING_MS),
            },
          },
          {
            processingStartedAt: null,
            updatedAt: {
              lt: new Date(now.getTime() - ACCOUNT_DELETION_SIDE_EFFECT_STALE_PROCESSING_MS),
            },
          },
        ],
      },
    ],
  };
}

export async function claimAccountDeletionSideEffect(
  id: string,
  client: AccountDeletionSideEffectDb = getAccountDeletionSideEffectClient(),
): Promise<AccountDeletionSideEffectClaimResult> {
  const rows = await client.$queryRaw<Array<{
    action: unknown;
    side_effect_id: unknown;
    user_id: unknown;
    effect_kind: unknown;
    effect_payload: unknown;
    attempt_count: unknown;
    claim_generation: unknown;
    claim_token: unknown;
  }>>`
    SELECT
      action,
      side_effect_id,
      user_id,
      effect_kind,
      effect_payload,
      attempt_count,
      claim_generation,
      claim_token
    FROM public.grainline_account_deletion_side_effect_claim(${id})
  `;
  const row = rows[0];
  if (rows.length !== 1 || !row || typeof row.action !== "string") {
    throw new Error("Account deletion side-effect claim returned an invalid result");
  }
  const action = row.action;
  if (action !== "process") {
    if (!["done", "missing", "unavailable"].includes(action)) {
      throw new Error("Account deletion side-effect claim returned an unknown action");
    }
    return {
      action: action as "done" | "missing" | "unavailable",
    };
  }
  if (
    typeof row.side_effect_id !== "string"
    || typeof row.user_id !== "string"
    || typeof row.effect_kind !== "string"
    || typeof row.attempt_count !== "number"
    || typeof row.claim_generation !== "bigint"
    || typeof row.claim_token !== "string"
  ) {
    throw new Error("Account deletion side-effect claim returned an invalid payload");
  }
  return {
    action: "process" as const,
    effect: {
      id: row.side_effect_id,
      userId: row.user_id,
      kind: row.effect_kind,
      payload: row.effect_payload as Prisma.JsonValue,
      attempts: row.attempt_count,
      claimGeneration: row.claim_generation,
      claimToken: row.claim_token,
    } satisfies AccountDeletionSideEffectClaim,
  };
}

async function completeAccountDeletionSideEffect(
  id: string,
  claimGeneration: bigint,
  claimToken: string,
  client: AccountDeletionSideEffectDb = getAccountDeletionSideEffectClient(),
) {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_account_deletion_side_effect_complete(
      ${id},
      ${claimGeneration},
      ${claimToken}::uuid
    ) AS result
  `;
  const result = rows[0]?.result;
  if (
    rows.length !== 1
    || !["completed", "already_completed", "superseded", "missing"].includes(String(result))
  ) {
    throw new Error("Account deletion side-effect completion returned an invalid result");
  }
  return String(result);
}

async function failAccountDeletionSideEffect(
  id: string,
  claimGeneration: bigint,
  claimToken: string,
  lastError: string,
  client: AccountDeletionSideEffectDb = getAccountDeletionSideEffectClient(),
) {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_account_deletion_side_effect_fail(
      ${id},
      ${claimGeneration},
      ${claimToken}::uuid,
      ${lastError}
    ) AS result
  `;
  const result = rows[0]?.result;
  if (rows.length !== 1 || !["failed", "superseded"].includes(String(result))) {
    throw new Error("Account deletion side-effect failure returned an invalid result");
  }
  return String(result);
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

export function accountDeletionMediaDeleteDedupKey(userId: string, key: string) {
  return `account-delete:media:${userId}:${hashDedupPart(key)}`;
}

export function accountDeletionAuditRedactDedupKey(userId: string, logId: string) {
  return `account-delete:audit:${userId}:${logId}`;
}

export async function enqueueAccountDeletionLocalAnonymizeSideEffect(
  db: AccountDeletionSideEffectDb,
  userId: string,
) {
  const dedupKey = accountDeletionLocalAnonymizeDedupKey(userId);
  await enqueueAccountDeletionSideEffect(db, {
    userId,
    kind: ACCOUNT_DELETION_SIDE_EFFECT_KIND.LOCAL_ANONYMIZE,
    dedupKey,
  });
  const effect = await db.accountDeletionSideEffect.findUnique({
    where: { dedupKey },
    select: { id: true },
  });
  if (!effect) {
    throw new Error(
      "Account deletion local anonymization source was not retained",
    );
  }
  return effect.id;
}

export async function markAccountDeletionLocalAnonymizeDone(
  sideEffectId: string,
  claimGeneration: bigint,
  claimToken: string,
) {
  const result = await completeAccountDeletionSideEffect(
    sideEffectId,
    claimGeneration,
    claimToken,
  );
  if (result !== "completed" && result !== "already_completed") {
    throw new Error("Account deletion local anonymization claim was superseded");
  }
}

export async function enqueueAccountDeletionMediaDeleteSideEffects(
  db: AccountDeletionSideEffectDb,
  claim: {
    sideEffectId: string;
    claimGeneration: bigint;
    claimToken: string;
  },
  keys: string[],
) {
  for (const batch of accountDeletionMediaKeyBatches(keys)) {
    await db.$queryRaw<Array<{ grainline_account_deletion_media_key_enqueue_claimed: bigint }>>`
      SELECT public.grainline_account_deletion_media_key_enqueue_claimed(
        ${claim.sideEffectId},
        ${claim.claimGeneration},
        ${claim.claimToken}::uuid,
        ${batch}::text[]
      )
    `;
  }
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
  const accountDeletionClient = getAccountDeletionSideEffectClient();
  const dedupKey = accountDeletionStripeRejectDedupKey(input.userId, input.stripeAccountId);
  await enqueueAccountDeletionSideEffect(accountDeletionClient, {
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
  claimGeneration: bigint;
  claimToken: string;
}) {
  const payload = payloadObject(effect.payload);

  if (effect.kind === ACCOUNT_DELETION_SIDE_EFFECT_KIND.LOCAL_ANONYMIZE) {
    const { anonymizeUserAccount } = await import("@/lib/accountDeletion");
    const result = await anonymizeUserAccount(effect.userId, {
      sideEffectId: effect.id,
      claimGeneration: effect.claimGeneration,
      claimToken: effect.claimToken,
    });
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
    await clearSellerAccountDeletionReconciliation(prisma, {
      userId: effect.userId,
      stripeAccountId: payload.stripeAccountId,
      sideEffectId: effect.id,
      claimGeneration: effect.claimGeneration,
      claimToken: effect.claimToken,
    });
    return;
  }

  if (effect.kind === ACCOUNT_DELETION_SIDE_EFFECT_KIND.MEDIA_DELETE) {
    if (typeof payload.key === "string") {
      await deleteR2ObjectByKey(payload.key);
      return;
    }
    // Preparation keeps the predecessor URL enqueue RPC available while old
    // instances drain. Process rows they already created; activation refuses
    // to retire that RPC until no unfinished URL-form media row remains.
    if (typeof payload.url === "string") {
      const deleted = await deleteR2ObjectByUrl(payload.url);
      if (!deleted) throw new Error("Account deletion media URL was not deleted");
      return;
    }
    throw new Error("Missing media key for account deletion side effect");
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
  const effect = await getAccountDeletionSideEffectClient().accountDeletionSideEffect.findUnique({
    where: { dedupKey },
    select: { id: true },
  });
  if (!effect) return true;
  return processAccountDeletionSideEffect(effect.id);
}

export async function processAccountDeletionSideEffect(id: string) {
  const claim = await claimAccountDeletionSideEffect(id);
  if (claim.action !== "process") return claim.action === "done";
  const effect = claim.effect;

  try {
    await performAccountDeletionSideEffect(effect);
    const completion = await completeAccountDeletionSideEffect(
      effect.id,
      effect.claimGeneration,
      effect.claimToken,
    );
    return completion === "completed" || completion === "already_completed";
  } catch (error) {
    const lastError = sanitizeSideEffectError(error);
    await failAccountDeletionSideEffect(
      effect.id,
      effect.claimGeneration,
      effect.claimToken,
      lastError,
    );
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
  const effects = await getAccountDeletionSideEffectClient().accountDeletionSideEffect.findMany({
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
  const effects = await getAccountDeletionSideEffectClient().accountDeletionSideEffect.findMany({
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

export async function pruneCompletedAccountDeletionSideEffects({
  now = new Date(),
  batchSize = ACCOUNT_DELETION_SIDE_EFFECT_DONE_RETENTION_BATCH_SIZE,
  timeBudgetMs = ACCOUNT_DELETION_SIDE_EFFECT_DONE_RETENTION_TIME_BUDGET_MS,
}: {
  now?: Date;
  batchSize?: number;
  timeBudgetMs?: number;
} = {}) {
  const cutoff = accountDeletionSideEffectDoneRetentionCutoff(now);

  return runBoundedDeletionBatches({
    batchSize,
    timeBudgetMs,
    deleteBatch: async () => getAccountDeletionSideEffectClient().$executeRaw<number>`
      DELETE FROM "AccountDeletionSideEffect"
      WHERE id IN (
        SELECT id
        FROM "AccountDeletionSideEffect"
        WHERE status = ${ACCOUNT_DELETION_SIDE_EFFECT_STATUS.DONE}
          AND "processedAt" IS NOT NULL
          AND "processedAt" < ${cutoff}
        ORDER BY "processedAt" ASC
        LIMIT ${batchSize}
      )
    `,
  });
}
