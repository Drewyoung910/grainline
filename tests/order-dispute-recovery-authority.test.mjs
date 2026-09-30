import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260930040000_prepare_order_dispute_recovery/migration.sql",
  "utf8",
);
const schema = readFileSync("prisma/schema.prisma", "utf8");
const retryRoute = readFileSync(
  "src/app/api/cron/order-dispute-recovery/route.ts",
  "utf8",
);
const retryWorker = readFileSync(
  "src/lib/orderDisputeRecoveryRetry.ts",
  "utf8",
);
const opsHealth = readFileSync("src/app/api/cron/ops-health/route.ts", "utf8");
const stripeWebhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));

test("dispute recovery stays behind fixed functions and policyless FORCE RLS", () => {
  assert.match(schema, /enum OrderDisputeRecoveryStatus[\s\S]*MANUAL_REVIEW/);
  assert.match(schema, /model OrderDisputeRecovery/);
  assert.match(migration, /ALTER TABLE public\."OrderDisputeRecovery" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE public\."OrderDisputeRecovery" FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\."OrderDisputeRecovery" FROM PUBLIC, grainline_app_runtime/,
  );
  assert.equal((migration.match(/CREATE FUNCTION/g) ?? []).length, 4);
  assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 4);
  assert.match(migration, /WHEN 1 THEN interval '15 minutes'/);
  assert.match(migration, /WHEN 2 THEN interval '1 hour'/);
  assert.match(migration, /WHEN 3 THEN interval '6 hours'/);
  assert.match(migration, /ELSE interval '24 hours'/);
  assert.match(migration, /"attemptCount" >= 5[\s\S]*'MANUAL_REVIEW'/);
});

test("retry, cron, ops health, and runtime provisioning are bounded", () => {
  assert.match(retryWorker, /claimOrderDisputeRecoveryBatch\(1\)/);
  assert.match(retryWorker, /MINIMUM_PROVIDER_BUDGET_MS = 20_000/);
  assert.match(retryRoute, /verifyCronRequest\(request\)/);
  assert.match(retryRoute, /beginCronRun\([\s\S]*"order-dispute-recovery"/);
  assert.deepEqual(
    vercel.crons.filter((entry) => entry.path === "/api/cron/order-dispute-recovery"),
    [{ path: "/api/cron/order-dispute-recovery", schedule: "5,35 * * * *" }],
  );
  assert.match(opsHealth, /orderDisputeRecoveryHealthSummary\(\)/);
  assert.match(opsHealth, /orderDisputeRecoveryManualReviewCount/);
  assert.match(opsHealth, /orderDisputeRecoveryOverdueRetryCount/);
  for (const signature of [
    'grainline_order_dispute_recovery_event_claim"(text)',
    'grainline_order_dispute_recovery_finalize"(text,bigint,text,text,integer,text,text)',
    'grainline_order_dispute_recovery_claim_batch"(integer)',
    'grainline_order_dispute_recovery_health_summary"()',
  ]) {
    assert.ok(
      provisioning.split(signature).length >= 4,
      `runtime provisioning must revoke and grant ${signature}`,
    );
  }
  assert.doesNotMatch(
    provisioning,
    /GRANT (?:SELECT|INSERT|UPDATE|DELETE)[^;]*OrderDisputeRecovery/,
  );
});

test("signed dispute evidence commits a first claim before bounded provider settlement", () => {
  const transactionStart = stripeWebhook.indexOf(
    "const { disputeResult, recoveryClaim } = await prisma.$transaction",
  );
  const signedApply = stripeWebhook.indexOf(
    "await applySignedDisputeWebhook(tx",
    transactionStart,
  );
  const replayGuard = stripeWebhook.indexOf(
    'result.action === "applied"',
    signedApply,
  );
  const claim = stripeWebhook.indexOf(
    "await claimOrderDisputeRecoveryForEvent(result.paymentEventId, tx)",
    replayGuard,
  );
  const transactionResult = stripeWebhook.indexOf(
    "return { disputeResult: result, recoveryClaim };",
    claim,
  );
  const transactionEnd = stripeWebhook.indexOf("});", transactionResult);
  const settlement = stripeWebhook.indexOf(
    "await settleOrderDisputeRecovery(recoveryClaim)",
    transactionEnd,
  );
  const response = stripeWebhook.indexOf(
    "return NextResponse.json({ received: true });",
    settlement,
  );
  assert.ok(transactionStart >= 0);
  assert.ok(transactionStart < signedApply);
  assert.ok(signedApply < replayGuard);
  assert.ok(replayGuard < claim);
  assert.ok(claim < transactionResult);
  assert.ok(transactionResult < transactionEnd);
  assert.ok(transactionEnd < settlement);
  assert.ok(settlement < response);
  assert.match(
    stripeWebhook.slice(settlement, response),
    /recoveryResult\.providerFailed[\s\S]*disputeRecoveryErrorSummary/,
  );
});

test("database authority reverses then restores one dispute through runtime-only operations", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
      SET TIME ZONE 'UTC';
      CREATE TABLE public."Order" (
        id text PRIMARY KEY,
        currency varchar(3) NOT NULL,
        "stripeChargeId" varchar(255),
        "stripeTransferId" varchar(255),
        "reviewNeeded" boolean NOT NULL DEFAULT false,
        "reviewNote" text
      );
      CREATE TABLE public."OrderPaymentEvent" (
        id text PRIMARY KEY,
        "orderId" text NOT NULL,
        "eventType" text NOT NULL,
        "stripeObjectType" text,
        "stripeObjectId" text,
        "amountCents" integer,
        currency varchar(3),
        status text,
        metadata jsonb,
        "stripeEventCreatedSeconds" bigint,
        UNIQUE (id, "orderId")
      );
      CREATE TABLE public."SystemAuditLog" (
        id text PRIMARY KEY,
        "actorType" varchar(40) NOT NULL,
        "actorId" varchar(255),
        action varchar(100) NOT NULL,
        "targetType" varchar(100) NOT NULL,
        "targetId" varchar(255) NOT NULL,
        reason varchar(1000),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      REVOKE ALL ON public."Order", public."OrderPaymentEvent",
        public."SystemAuditLog" FROM PUBLIC, grainline_app_runtime;
      INSERT INTO public."Order" (
        id, currency, "stripeChargeId", "stripeTransferId"
      ) VALUES ('order-one', 'usd', 'ch_one', 'tr_seller');
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "eventType", "stripeObjectType", "stripeObjectId",
        "amountCents", currency, status, metadata,
        "stripeEventCreatedSeconds"
      ) VALUES (
        'payment-one', 'order-one', 'DISPUTE', 'dispute', 'du_one',
        3000, 'usd', 'needs_response',
        '{"stripeEventType":"charge.dispute.created","orderingAction":"applied"}',
        100
      );
    `);
    await database.exec(migration);

    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query('SELECT * FROM public."OrderDisputeRecovery"'),
      /permission denied/,
    );
    const reversalClaim = await database.query(
      "SELECT public.grainline_order_dispute_recovery_event_claim('payment-one') AS result",
    );
    assert.equal(reversalClaim.rows[0].result.action, "REVERSE");
    assert.equal(reversalClaim.rows[0].result.amountCents, 3000);
    const recoveryId = reversalClaim.rows[0].result.recoveryId;
    const reversalFinalized = await database.query(
      `SELECT public.grainline_order_dispute_recovery_finalize(
        '${recoveryId}', 1, 'SUCCESS', 'trr_dispute', 1500,
        'acct_seller', NULL
      ) AS result`,
    );
    assert.equal(reversalFinalized.rows[0].result.status, "REVERSED");
    await database.exec("RESET ROLE");

    await database.exec(`
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "eventType", "stripeObjectType", "stripeObjectId",
        "amountCents", currency, status, metadata,
        "stripeEventCreatedSeconds"
      ) VALUES (
        'payment-two', 'order-one', 'DISPUTE', 'dispute', 'du_one',
        3000, 'usd', 'won',
        '{"stripeEventType":"charge.dispute.funds_reinstated","orderingAction":"applied"}',
        200
      );
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    const restoreClaim = await database.query(
      "SELECT public.grainline_order_dispute_recovery_event_claim('payment-two') AS result",
    );
    assert.equal(restoreClaim.rows[0].result.action, "RESTORE");
    assert.equal(restoreClaim.rows[0].result.reversedAmountCents, 1500);
    const restored = await database.query(
      `SELECT public.grainline_order_dispute_recovery_finalize(
        '${recoveryId}', 2, 'SUCCESS', 'tr_restore', 1500,
        'acct_seller', NULL
      ) AS result`,
    );
    assert.equal(restored.rows[0].result.status, "RESTORED");
    const health = await database.query(
      "SELECT * FROM public.grainline_order_dispute_recovery_health_summary()",
    );
    assert.equal(Number(health.rows[0].manual_review_count), 0);
    assert.equal(Number(health.rows[0].overdue_retry_count), 0);
    await database.exec("RESET ROLE");
  } finally {
    await database.close();
  }
});
