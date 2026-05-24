import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account deletion side-effect retries", () => {
  it("adds a durable side-effect table with retry and dedup indexes", () => {
    const schema = source("prisma/schema.prisma");
    const migration = source("prisma/migrations/20260524001500_add_account_deletion_side_effects/migration.sql");

    assert.match(schema, /model AccountDeletionSideEffect/);
    assert.match(schema, /dedupKey\s+String\s+@unique\s+@db\.VarChar\(300\)/);
    assert.match(schema, /payload\s+Json\s+@default\("\{}"\)/);
    assert.match(schema, /@@index\(\[status, nextAttemptAt\]\)/);
    assert.match(schema, /@@index\(\[userId, kind\]\)/);
    assert.match(migration, /CREATE TABLE "AccountDeletionSideEffect"/);
    assert.match(migration, /CREATE UNIQUE INDEX "AccountDeletionSideEffect_dedupKey_key"/);
  });

  it("records local anonymization before Clerk deletion and marks it done only after the DB transaction", () => {
    const route = source("src/app/api/account/delete/route.ts");
    const deletion = source("src/lib/accountDeletion.ts");

    assert.ok(
      route.indexOf("enqueueAccountDeletionLocalAnonymizeSideEffect(prisma, me.id)") <
        route.indexOf("users.deleteUser(clerkId)"),
      "local recovery row must exist before Clerk is deleted",
    );
    assert.ok(
      deletion.indexOf("enqueueAccountDeletionLocalAnonymizeSideEffect(prisma, userId)", deletion.indexOf("export async function anonymizeUserAccount")) <
        deletion.indexOf("runAccountDeletionStripeRejectSideEffect", deletion.indexOf("export async function anonymizeUserAccount")),
      "local recovery row must exist before Stripe rejection",
    );
    assert.ok(
      deletion.indexOf("}, { timeout: 30000, maxWait: 10000 }).catch") <
        deletion.indexOf("markAccountDeletionLocalAnonymizeDone(prisma, userId)"),
      "local recovery row should stay pending if the anonymization transaction fails",
    );
  });

  it("queues Stripe, media, and audit redaction work through retryable side effects", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const sideEffects = source("src/lib/accountDeletionSideEffects.ts");

    assert.match(deletion, /runAccountDeletionStripeRejectSideEffect\(\{/);
    assert.match(deletion, /collectAccountDeletionMediaUrls\(tx, user\.id, user\.clerkId\)/);
    assert.match(deletion, /enqueueAccountDeletionMediaDeleteSideEffects\(tx, user\.id, mediaUrls\)/);
    assert.match(deletion, /collectAdminAuditLogRedactionUpdates\(\{/);
    assert.match(deletion, /enqueueAccountDeletionAuditRedactionSideEffects\(prisma, userId, redactionUpdates\)/);
    assert.match(deletion, /processAccountDeletionSideEffectsForUser\(userId, \[/);
    assert.doesNotMatch(deletion, /deleteR2ObjectByUrl/);
    assert.doesNotMatch(deletion, /mapWithConcurrency\(mediaUrls/);

    assert.match(sideEffects, /stripe\.accounts\.reject\(payload\.stripeAccountId/);
    assert.match(sideEffects, /manualStripeReconciliationNote: \{\s*startsWith: "Account deletion could not reject Stripe Connect account"/s);
    assert.match(sideEffects, /manualStripeReconciliationNeeded: false/);
    assert.match(sideEffects, /deleteR2ObjectByUrl\(payload\.url\)/);
    assert.match(sideEffects, /prisma\.adminAuditLog\.update/);
    assert.match(sideEffects, /payload: \{\}/);
    assert.match(sideEffects, /sanitizeSideEffectError/);
  });

  it("schedules a cron to retry pending account-deletion side effects", () => {
    const route = source("src/app/api/cron/account-deletion-side-effects/route.ts");
    const vercel = source("vercel.json");

    assert.match(route, /verifyCronRequest\(request\)/);
    assert.match(route, /beginCronRun\("account-deletion-side-effects", halfHourBucket\(\)\)/);
    assert.match(route, /processAccountDeletionSideEffectBatch\(\{ take: 20 \}\)/);
    assert.match(route, /completeCronRun\(cronRun, result\)/);
    assert.match(vercel, /"path": "\/api\/cron\/account-deletion-side-effects"/);
    assert.match(vercel, /"schedule": "10,40 \* \* \* \*"/);
  });
});
