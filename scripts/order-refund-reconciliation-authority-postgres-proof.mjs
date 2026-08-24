#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV = "ORDER_REFUND_RECONCILIATION_AUTHORITY_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const MIGRATION_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const PREFIX = "order-refund-reconciliation-pg-proof";
const DIGEST = "a".repeat(64);

const ids = Object.freeze({
  sellerUser: `${PREFIX}-seller-user`,
  sellerProfile: `${PREFIX}-seller-profile`,
  employeeUser: `${PREFIX}-employee-user`,
  adminUser: `${PREFIX}-admin-user`,
  order: `${PREFIX}-order`,
  blockedOrder: `${PREFIX}-blocked-order`,
  blockedEvent: `${PREFIX}-blocked-event`,
  blockedSession: `${PREFIX}-blocked-session`,
});

const expectedFunctions = Object.freeze([
  Object.freeze({
    identity: "grainline_blocked_checkout_refund_reconciliation_record(text,text,bigint,text,text,text,integer)",
    securityDefiner: true,
    volatility: "v",
    parallel: "u",
    runtimeExecute: true,
  }),
  Object.freeze({
    identity: "grainline_blocked_checkout_refund_record_core(text,bigint,text,bigint,text,text,text,integer)",
    securityDefiner: true,
    volatility: "v",
    parallel: "u",
    runtimeExecute: false,
  }),
  Object.freeze({
    identity: "grainline_order_refund_claim_mark_ambiguous(text,bigint,text)",
    securityDefiner: true,
    volatility: "v",
    parallel: "u",
    runtimeExecute: true,
  }),
  Object.freeze({
    identity: "grainline_order_refund_reconcile(text,text,bigint,text,text,bigint,text,text)",
    securityDefiner: true,
    volatility: "v",
    parallel: "u",
    runtimeExecute: true,
  }),
  Object.freeze({
    identity: "grainline_order_refund_reconciliation_immutable()",
    securityDefiner: false,
    volatility: "v",
    parallel: "u",
    runtimeExecute: false,
  }),
  Object.freeze({
    identity: "grainline_order_refund_reconciliation_prepare(text,text)",
    securityDefiner: true,
    volatility: "s",
    parallel: "u",
    runtimeExecute: true,
  }),
]);

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      "$1[redacted-credentials]@",
    );
}

export function parseOrderRefundReconciliationAuthorityProofConfig(
  env = process.env,
) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Order refund reconciliation authority proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    "Order refund reconciliation authority proof requires grainline_ci",
  );
  assert.equal(
    decodeURIComponent(parsed.username),
    MIGRATION_ROLE,
    "Order refund reconciliation authority proof requires the ci migration role",
  );
  return Object.freeze({ databaseUrl });
}

function createClient(databaseUrl) {
  return new Client({
    application_name: PREFIX,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
}

let savepointSequence = 0;

async function withSavepoint(client, work) {
  savepointSequence += 1;
  const savepoint = `reconciliation_proof_${savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await work();
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
    await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
    throw error;
  }
}

async function runtimeQuery(client, sql, params = []) {
  savepointSequence += 1;
  const savepoint = `reconciliation_runtime_${savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  await client.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
  try {
    const result = await client.query(sql, params);
    await client.query("RESET ROLE");
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    // A denied query aborts the transaction before RESET ROLE can run. Rolling
    // back to the pre-role savepoint restores both query and SET LOCAL state.
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
    await client.query("RESET ROLE").catch(() => {});
    await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
    throw error;
  }
}

async function expectError(label, work, expectedCode, pattern) {
  let caught;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, expectedCode, `${label} returned the wrong SQLSTATE`);
  assert.match(safeError(caught), pattern, label);
}

async function verifyCatalog(client) {
  const identity = await client.query(`
    SELECT current_database() AS database_name, CURRENT_USER AS current_user
  `);
  assert.deepEqual(identity.rows, [{
    database_name: DATABASE_NAME,
    current_user: MIGRATION_ROLE,
  }]);

  const table = await client.query(`
    SELECT
      c.relrowsecurity AS rls_enabled,
      c.relforcerowsecurity AS rls_forced,
      pg_catalog.pg_get_userbyid(c.relowner) AS owner,
      pg_catalog.has_table_privilege($1, c.oid, 'SELECT') AS can_select,
      pg_catalog.has_table_privilege($1, c.oid, 'INSERT') AS can_insert,
      pg_catalog.has_table_privilege($1, c.oid, 'UPDATE') AS can_update,
      pg_catalog.has_table_privilege($1, c.oid, 'DELETE') AS can_delete,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = c.oid) AS policy_count
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'OrderRefundReconciliation'
  `, [RUNTIME_ROLE]);
  assert.deepEqual(table.rows, [{
    rls_enabled: true,
    rls_forced: true,
    owner: MIGRATION_ROLE,
    can_select: false,
    can_insert: false,
    can_update: false,
    can_delete: false,
    policy_count: 0,
  }]);

  const functions = await client.query(`
    SELECT
      p.proname || '(' || pg_catalog.replace(
        pg_catalog.oidvectortypes(p.proargtypes), ', ', ','
      ) || ')' AS identity,
      p.prosecdef AS security_definer,
      p.provolatile AS volatility,
      p.proparallel AS parallel,
      p.proconfig AS config,
      pg_catalog.pg_get_userbyid(p.proowner) AS owner,
      pg_catalog.has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
      EXISTS (
        SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
          ) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      ) AS public_execute
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY($2::text[])
    ORDER BY identity
  `, [
    RUNTIME_ROLE,
    expectedFunctions.map((entry) => entry.identity.slice(0, entry.identity.indexOf("("))),
  ]);
  assert.equal(functions.rowCount, expectedFunctions.length);
  for (const [index, row] of functions.rows.entries()) {
    const expected = expectedFunctions[index];
    assert.equal(row.identity, expected.identity);
    assert.equal(row.security_definer, expected.securityDefiner, row.identity);
    assert.equal(row.volatility, expected.volatility, row.identity);
    assert.equal(row.parallel, expected.parallel, row.identity);
    assert.deepEqual(row.config, ["search_path=pg_catalog"], row.identity);
    assert.equal(row.owner, MIGRATION_ROLE, row.identity);
    assert.equal(row.runtime_execute, expected.runtimeExecute, row.identity);
    assert.equal(row.public_execute, false, row.identity);
  }

  const trigger = await client.query(`
    SELECT trigger.tgenabled AS enabled,
           trigger.tgtype::integer AS type_bits,
           procedure.proname AS function_name
      FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = trigger.tgrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = trigger.tgfoid
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'OrderRefundReconciliation'
       AND trigger.tgname = 'grainline_order_refund_reconciliation_immutable'
       AND NOT trigger.tgisinternal
  `);
  assert.equal(trigger.rowCount, 1);
  assert.deepEqual(trigger.rows[0], {
    enabled: "O",
    type_bits: 27,
    function_name: "grainline_order_refund_reconciliation_immutable",
  });
}

async function seedFixtures(client) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    ) VALUES
      ($1, $2, $3, 'Refund proof seller', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Refund proof employee', 'EMPLOYEE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($7, $8, $9, 'Refund proof admin', 'ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.sellerUser,
    `clerk-${ids.sellerUser}`,
    `${ids.sellerUser}@example.invalid`,
    ids.employeeUser,
    `clerk-${ids.employeeUser}`,
    `${ids.employeeUser}@example.invalid`,
    ids.adminUser,
    `clerk-${ids.adminUser}`,
    `${ids.adminUser}@example.invalid`,
  ]);
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    ) VALUES ($1, $2, 'Refund proof seller', 'refund proof seller',
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [ids.sellerProfile, ids.sellerUser]);
  await client.query(`
    INSERT INTO public."Order" (
      id, "sellerProfileId", "paidAt", "stripePaymentIntentId",
      "stripeTransferId", "stripeSessionId", currency, "itemsSubtotalCents",
      "shippingAmountCents", "giftWrappingPriceCents", "taxAmountCents"
    ) VALUES
      ($1, $2, CURRENT_TIMESTAMP, $3, $4, NULL, 'usd', 1000, 200, 50, 75),
      ($5, $2, CURRENT_TIMESTAMP, $6, NULL, $7, 'usd', 1000, 200, 50, 75)
  `, [
    ids.order,
    ids.sellerProfile,
    `pi_${PREFIX}`,
    `tr_${PREFIX}`,
    ids.blockedOrder,
    `pi_${PREFIX}_blocked`,
    ids.blockedSession,
  ]);
  await client.query(`
    INSERT INTO public."StripeWebhookEvent" (
      id, type, "sourceObjectId", "claimGeneration",
      "processingStartedAt", "createdAt", "updatedAt"
    ) VALUES (
      $1, 'checkout.session.completed', $2, 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.blockedEvent, ids.blockedSession]);
}

export async function runOrderRefundReconciliationAuthorityProof(
  env = process.env,
) {
  const { databaseUrl } =
    parseOrderRefundReconciliationAuthorityProofConfig(env);
  const client = createClient(databaseUrl);
  await client.connect();
  let transactionOpen = false;
  try {
    await verifyCatalog(client);
    await client.query("BEGIN");
    transactionOpen = true;
    await seedFixtures(client);

    await expectError(
      "runtime direct reconciliation-table read",
      () => runtimeQuery(
        client,
        'SELECT id FROM public."OrderRefundReconciliation" LIMIT 1',
      ),
      "42501",
      /permission denied for table OrderRefundReconciliation/,
    );

    const claimed = (await runtimeQuery(client, `
      SELECT public.grainline_seller_refund_claim($1, $2) AS result
    `, [ids.sellerUser, ids.order])).rows[0].result;
    assert.equal(claimed.action, "claimed");
    assert.equal(String(claimed.claimGeneration), "1");

    const ambiguous = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_claim_mark_ambiguous(
        $1, $2, 'SELLER_PROVIDER_AMBIGUOUS'
      ) AS result
    `, [claimed.claimId, claimed.claimGeneration])).rows[0].result;
    assert.equal(ambiguous.action, "recorded");

    await expectError(
      "employee reconciliation preparation",
      () => runtimeQuery(client, `
        SELECT public.grainline_order_refund_reconciliation_prepare($1, $2)
      `, [ids.employeeUser, ids.order]),
      "42501",
      /requires a current ADMIN/,
    );

    const prepared = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_reconciliation_prepare($1, $2)
        AS result
    `, [ids.adminUser, ids.order])).rows[0].result;
    assert.equal(prepared.claimId, claimed.claimId);
    assert.equal(prepared.state, "RECONCILIATION_REQUIRED");
    assert.equal(prepared.refundAmountCents, 1325);

    const inspectedAt = Number(prepared.providerAuthorizedAtSeconds);
    await expectError(
      "runtime short reconciliation reason",
      () => runtimeQuery(client, `
        SELECT public.grainline_order_refund_reconcile(
          $1, $2, $3, 'RETRY_EXISTING_SCOPE', 'short', $4, 'ABSENT', $5
        )
      `, [
        ids.adminUser,
        claimed.claimId,
        claimed.claimGeneration,
        inspectedAt,
        DIGEST,
      ]),
      "23514",
      /transition input is invalid/,
    );

    const reconciled = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_reconcile(
        $1, $2, $3, 'RETRY_EXISTING_SCOPE', $4, $5, 'ABSENT', $6
      ) AS result
    `, [
      ids.adminUser,
      claimed.claimId,
      claimed.claimGeneration,
      "PostgreSQL 16 runtime authority proof.",
      inspectedAt,
      DIGEST,
    ])).rows[0].result;
    assert.equal(reconciled.action, "retry_authorized");

    const replay = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_reconcile(
        $1, $2, $3, 'RETRY_EXISTING_SCOPE', $4, $5, 'ABSENT', $6
      ) AS result
    `, [
      ids.adminUser,
      claimed.claimId,
      claimed.claimGeneration,
      "PostgreSQL 16 runtime authority proof.",
      inspectedAt,
      DIGEST,
    ])).rows[0].result;
    assert.equal(replay.action, "replay");
    assert.equal(replay.reconciliationId, reconciled.reconciliationId);

    const evidence = await client.query(`
      SELECT action, "actorUserId", "providerDisposition",
             "providerEvidenceSha256"
        FROM public."OrderRefundReconciliation"
       WHERE "claimId" = $1
    `, [claimed.claimId]);
    assert.deepEqual(evidence.rows, [{
      action: "RETRY_EXISTING_SCOPE",
      actorUserId: ids.adminUser,
      providerDisposition: "ABSENT",
      providerEvidenceSha256: DIGEST,
    }]);

    await expectError(
      "owner reconciliation evidence update",
      () => withSavepoint(client, () => client.query(`
        UPDATE public."OrderRefundReconciliation"
           SET reason = 'rewritten'
         WHERE "claimId" = $1
      `, [claimed.claimId])),
      "23000",
      /evidence is immutable/,
    );

    const blockedClaim = (await runtimeQuery(client, `
      SELECT public.grainline_blocked_checkout_refund_claim(
        $1, 1, $2, $3, 1325
      ) AS result
    `, [ids.blockedEvent, ids.blockedSession, ids.blockedOrder])).rows[0].result;
    assert.equal(blockedClaim.action, "claimed");

    const blockedAmbiguous = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_claim_mark_ambiguous(
        $1, $2, 'BLOCKED_CHECKOUT_PROVIDER_AMBIGUOUS'
      ) AS result
    `, [blockedClaim.claimId, blockedClaim.claimGeneration])).rows[0].result;
    assert.equal(blockedAmbiguous.action, "recorded");

    // Production failure handling releases the webhook processing lease before
    // an administrator can inspect the provider. Recovery must not fabricate a
    // lease or rely on a concurrent retry to make the finalizer reachable.
    await client.query(`
      UPDATE public."StripeWebhookEvent"
         SET "processingStartedAt" = NULL,
             "lastError" = 'sanitized proof failure',
             "updatedAt" = CURRENT_TIMESTAMP
       WHERE id = $1
    `, [ids.blockedEvent]);

    const blockedPrepared = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_reconciliation_prepare($1, $2)
        AS result
    `, [ids.adminUser, ids.blockedOrder])).rows[0].result;
    const blockedInspectedAt = Number(
      blockedPrepared.providerAuthorizedAtSeconds,
    );
    const blockedReconciled = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_reconcile(
        $1, $2, $3, 'RETRY_EXISTING_SCOPE', $4, $5, 'ABSENT', $6
      ) AS result
    `, [
      ids.adminUser,
      blockedClaim.claimId,
      blockedClaim.claimGeneration,
      "PostgreSQL failed-lease recovery proof.",
      blockedInspectedAt,
      "b".repeat(64),
    ])).rows[0].result;
    assert.equal(blockedReconciled.action, "retry_authorized");

    await expectError(
      "inactive signed-lease blocked-checkout record",
      () => runtimeQuery(client, `
        SELECT public.grainline_blocked_checkout_refund_record(
          $1, 1, $2, $3, 're_blockedpgproof', 'succeeded', NULL, NULL
        )
      `, [
        ids.blockedEvent,
        blockedClaim.claimId,
        blockedClaim.claimGeneration,
      ]),
      "42501",
      /source lease is inactive/,
    );

    await expectError(
      "direct blocked-checkout record core",
      () => runtimeQuery(client, `
        SELECT public.grainline_blocked_checkout_refund_record_core(
          $1, 1, $2, $3, 're_blockedpgproof', 'succeeded', NULL, NULL
        )
      `, [
        ids.blockedEvent,
        blockedClaim.claimId,
        blockedClaim.claimGeneration,
      ]),
      "42501",
      /permission denied for function grainline_blocked_checkout_refund_record_core/,
    );

    await expectError(
      "forged blocked-checkout reconciliation record",
      () => runtimeQuery(client, `
        SELECT public.grainline_blocked_checkout_refund_reconciliation_record(
          'order-refund-reconcile:00000000-0000-0000-0000-000000000000',
          $1, $2, 're_blockedpgproof', 'succeeded', NULL, NULL
        )
      `, [blockedClaim.claimId, blockedClaim.claimGeneration]),
      "42501",
      /reconciliation authority is invalid/,
    );

    const blockedRecorded = (await runtimeQuery(client, `
      SELECT public.grainline_blocked_checkout_refund_reconciliation_record(
        $1, $2, $3, 're_blockedpgproof', 'succeeded', NULL, NULL
      ) AS result
    `, [
      blockedReconciled.reconciliationId,
      blockedClaim.claimId,
      blockedClaim.claimGeneration,
    ])).rows[0].result;
    assert.equal(blockedRecorded.action, "recorded");
    assert.equal(blockedRecorded.orderId, ids.blockedOrder);

    const completedEvent = await client.query(`
      SELECT "processingStartedAt", "processedAt", "lastError"
        FROM public."StripeWebhookEvent"
       WHERE id = $1
    `, [ids.blockedEvent]);
    assert.equal(completedEvent.rows[0].processingStartedAt, null);
    assert.ok(completedEvent.rows[0].processedAt instanceof Date);
    assert.equal(completedEvent.rows[0].lastError, null);

    await client.query("ROLLBACK");
    transactionOpen = false;
    const residue = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."User"
       WHERE id = ANY($1::text[])
    `, [[ids.sellerUser, ids.employeeUser, ids.adminUser]]);
    assert.equal(residue.rows[0].count, 0);

    return Object.freeze({
      database: DATABASE_NAME,
      migrationRole: MIGRATION_ROLE,
      runtimeRole: RUNTIME_ROLE,
      rlsEnabled: true,
      rlsForced: true,
      policyCount: 0,
      exactFunctions: expectedFunctions.length,
      directRuntimeTableAccessDenied: true,
      employeeDenied: true,
      adminPreparedExactClaim: true,
      exactReplayIdempotent: true,
      ownerMutationRejected: true,
      failedLeaseRecoveryBoundToReconciliation: true,
      residueRows: 0,
      productionTouched: false,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runOrderRefundReconciliationAuthorityProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Order refund reconciliation authority PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
