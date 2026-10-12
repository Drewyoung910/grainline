import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const {
  ACCOUNT_DELETION_SIDE_EFFECT_DONE_RETENTION_DAYS,
  accountDeletionSideEffectDoneRetentionCutoff,
} = await import("../src/lib/accountDeletionSideEffectRetentionState.ts");

describe("account deletion side-effect retries", () => {
  it("adds a durable side-effect table with retry and dedup indexes", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260524001500_add_account_deletion_side_effects/migration.sql");
    const retentionMigration = source(
      "prisma/migrations/20260621233500_account_deletion_side_effect_retention/migration.sql",
    );

    assert.match(schema, /model AccountDeletionSideEffect/);
    assert.match(schema, /dedupKey\s+String\s+@unique\s+@db\.VarChar\(300\)/);
    assert.match(schema, /payload\s+Json\s+@default\("\{}"\)/);
    assert.match(schema, /@@index\(\[status, nextAttemptAt\]\)/);
    assert.match(schema, /@@index\(\[status, processedAt\]\)/);
    assert.match(schema, /@@index\(\[userId, kind\]\)/);
    assert.match(migration, /CREATE TABLE "AccountDeletionSideEffect"/);
    assert.match(migration, /CREATE UNIQUE INDEX "AccountDeletionSideEffect_dedupKey_key"/);
    assert.match(retentionMigration, /CREATE INDEX "AccountDeletionSideEffect_status_processedAt_idx"/);
  });

  it("records local anonymization only after Clerk deletion and marks it done after the DB transaction", () => {
    const route = source("src/app/api/account/delete/route.ts");
    const deletion = source("src/lib/accountDeletion.ts");
    const routeEnqueue = route.indexOf("enqueueAccountDeletionLocalAnonymizeSideEffect(");
    const deletionFunction = deletion.indexOf("export async function anonymizeUserAccount");
    const deletionEnqueue = deletion.indexOf(
      "enqueueAccountDeletionLocalAnonymizeSideEffect(",
      deletionFunction,
    );

    assert.ok(
      route.indexOf("users.deleteUser(clerkId)") < routeEnqueue,
      "route must not leave a claimable local anonymization job when Clerk deletion fails",
    );
    assert.ok(
      routeEnqueue < route.indexOf("anonymizeUserAccount(me.id, {"),
      "local recovery row must exist before route-level anonymization begins after Clerk deletion",
    );
    assert.ok(
      deletionEnqueue <
        deletion.indexOf("runAccountDeletionStripeRejectSideEffect", deletionFunction),
      "local recovery row must exist before Stripe rejection",
    );
    const transactionEnd = deletion.indexOf("}, { timeout: 30000, maxWait: 10000 }).catch");
    assert.ok(
      transactionEnd <
        deletion.indexOf("markAccountDeletionLocalAnonymizeDone(", transactionEnd),
      "local recovery row should stay pending if the anonymization transaction fails",
    );
    assert.match(
      route,
      /catch \(error\) \{\s*await releaseAccountDeletionLock\(deletionLock\)\.catch/s,
    );
  });

  it("queues Stripe, media, and audit redaction work through retryable side effects", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const sideEffects = source("src/lib/accountDeletionSideEffects.ts");
    const claimFence = source(
      "prisma/migrations/20261011170000_prepare_account_deletion_side_effect_claim_fence/migration.sql",
    );
    const mediaKeyFence = source(
      "prisma/migrations/20261011173000_prepare_account_deletion_media_key_fence/migration.sql",
    );

    assert.match(deletion, /runAccountDeletionStripeRejectSideEffect\(\{/);
    assert.match(deletion, /collectAccountDeletionMediaKeys\(tx, user\.id, user\.clerkId\)/);
    assert.match(
      deletion,
      /enqueueAccountDeletionMediaDeleteSideEffects\([\s\S]*sideEffectId: localAnonymizeSideEffectId,[\s\S]*claimGeneration: localClaimGeneration,[\s\S]*claimToken: localClaimToken,[\s\S]*mediaKeys,/,
    );
    assert.match(deletion, /collectAdminAuditLogRedactionUpdates\(\{/);
    assert.match(
      deletion,
      /enqueueAccountDeletionAuditRedactionSideEffects\(\s*getAccountDeletionSideEffectClient\(\),\s*userId,\s*redactionUpdates,/s,
    );
    assert.match(deletion, /processAccountDeletionSideEffectsForUser\(userId, \[/);
    assert.doesNotMatch(deletion, /deleteR2ObjectByUrl/);
    assert.doesNotMatch(deletion, /mapWithConcurrency\(mediaKeys/);

    assert.match(sideEffects, /stripe\.accounts\.reject\(payload\.stripeAccountId/);
    assert.match(sideEffects, /manualStripeReconciliationNote: \{\s*startsWith: "Account deletion could not reject Stripe Connect account"/s);
    assert.match(sideEffects, /manualStripeReconciliationNeeded: false/);
    assert.match(sideEffects, /deleteR2ObjectByKey\(payload\.key\)/);
    assert.match(
      sideEffects,
      /for \(const batch of accountDeletionMediaKeyBatches\(keys\)\)/,
    );
    assert.match(sideEffects, /deleteR2ObjectByUrl\(payload\.url\)/);
    assert.match(
      sideEffects,
      /activation refuses[\s\S]*no unfinished URL-form media row remains/,
    );
    assert.match(sideEffects, /prisma\.adminAuditLog\.update/);
    assert.match(claimFence, /payload = '\{}'::jsonb/);
    assert.match(mediaKeyFence, /grainline_account_deletion_media_key_enqueue_claimed/);
    assert.match(mediaKeyFence, /source_actor_segment/);
    assert.match(mediaKeyFence, /pg_catalog\.sha256/);
    assert.match(sideEffects, /sanitizeSideEffectError/);
  });

  it("reclaims stale PROCESSING side effects without taking fresh in-flight work", () => {
    const sideEffects = source("src/lib/accountDeletionSideEffects.ts");
    const claimFence = source(
      "prisma/migrations/20261011170000_prepare_account_deletion_side_effect_claim_fence/migration.sql",
    );
    const opsHealth = source("src/app/api/cron/ops-health/route.ts");

    assert.match(sideEffects, /ACCOUNT_DELETION_SIDE_EFFECT_STALE_PROCESSING_MS = 60 \* 60 \* 1000/);
    assert.match(sideEffects, /function claimableAccountDeletionSideEffectWhere/);
    assert.match(
      sideEffects,
      /status: ACCOUNT_DELETION_SIDE_EFFECT_STATUS\.PROCESSING,[\s\S]*processingStartedAt:[\s\S]*processingStartedAt: null,[\s\S]*updatedAt:/,
    );
    assert.match(
      sideEffects,
      /status: \{\s*in: \[\s*ACCOUNT_DELETION_SIDE_EFFECT_STATUS\.PENDING,\s*ACCOUNT_DELETION_SIDE_EFFECT_STATUS\.FAILED,\s*\],\s*\},\s*OR: \[\{ nextAttemptAt: null \}, \{ nextAttemptAt: \{ lte: now \} \}\]/s,
    );
    assert.match(claimFence, /"claimGeneration" = effect\."claimGeneration" \+ 1/);
    assert.match(claimFence, /"claimToken" = pg_catalog\.gen_random_uuid\(\)/);
    assert.match(claimFence, /"processingStartedAt" = source_now/);
    assert.match(claimFence, /effect\."claimGeneration" = p_claim_generation/g);
    assert.match(claimFence, /effect\."claimToken" = p_claim_token/g);
    assert.match(claimFence, /effect\.status = 'PROCESSING'/g);
    assert.match(claimFence, /AccountDeletionSideEffect_status_processingStartedAt_idx/);
    assert.match(sideEffects, /grainline_account_deletion_side_effect_claim/);
    assert.match(sideEffects, /claimToken: row\.claim_token/);
    assert.match(sideEffects, /grainline_account_deletion_side_effect_complete/);
    assert.match(sideEffects, /grainline_account_deletion_side_effect_fail/);
    assert.doesNotMatch(
      sideEffects,
      /prisma\.accountDeletionSideEffect\.update\(\{\s*where: \{ id \}/s,
    );
    assert.match(opsHealth, /ACCOUNT_DELETION_SIDE_EFFECT_STALE_PROCESSING_MS/);
    assert.match(opsHealth, /processingStartedAt:/);
    assert.doesNotMatch(opsHealth, /const STALE_ACCOUNT_DELETION_SIDE_EFFECT_MS/);
  });

  it("schedules a cron to retry pending account-deletion side effects", () => {
    const route = source("src/app/api/cron/account-deletion-side-effects/route.ts");
    const vercel = source("vercel.json");

    assert.match(route, /verifyCronRequest\(request\)/);
    assert.match(route, /beginCronRun\("account-deletion-side-effects", halfHourBucket\(\)\)/);
    assert.match(route, /processAccountDeletionSideEffectBatch\(\{ take: 20 \}\)/);
    assert.match(route, /pruneCompletedAccountDeletionSideEffects\(\)/);
    assert.match(route, /completedPruned: pruneResult\.count/);
    assert.match(route, /completedPruneComplete: pruneResult\.complete/);
    assert.match(route, /completeCronRun\(cronRun, result\)/);
    assert.match(vercel, /"path": "\/api\/cron\/account-deletion-side-effects"/);
    assert.match(vercel, /"schedule": "10,40 \* \* \* \*"/);
  });

  it("prunes completed side-effect rows after the retention window without deleting retryable rows", () => {
    const now = new Date("2026-06-21T12:00:00.000Z");
    const cutoff = accountDeletionSideEffectDoneRetentionCutoff(now);
    const sideEffects = source("src/lib/accountDeletionSideEffects.ts");

    assert.equal(ACCOUNT_DELETION_SIDE_EFFECT_DONE_RETENTION_DAYS, 90);
    assert.equal(cutoff.toISOString(), "2026-03-23T12:00:00.000Z");
    assert.match(sideEffects, /export async function pruneCompletedAccountDeletionSideEffects/);
    assert.match(sideEffects, /runBoundedDeletionBatches\(\{/);
    assert.match(sideEffects, /FROM "AccountDeletionSideEffect"/);
    assert.match(sideEffects, /status = \$\{ACCOUNT_DELETION_SIDE_EFFECT_STATUS\.DONE\}/);
    assert.match(sideEffects, /"processedAt" IS NOT NULL/);
    assert.match(sideEffects, /"processedAt" < \$\{cutoff\}/);
    assert.doesNotMatch(sideEffects, /status IN \('PENDING', 'PROCESSING', 'FAILED'/);
  });
});
