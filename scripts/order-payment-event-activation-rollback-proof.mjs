#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
} from "./build-order-payment-event-activation-candidate.mjs";
import {
  parseOrderPaymentEventActivationProofConfig,
} from "./order-payment-event-activation-postgres-proof.mjs";
import {
  assertOrderPaymentEventActivationProductionScope,
  readOrderPaymentEventActivationProductionSnapshotFromClient,
} from "./verify-order-payment-event-activation-production-scope.mjs";
import {
  verifyOrderPaymentEventActivationRelease,
} from "./verify-order-payment-event-activation-release.mjs";

const { Client } = pg;
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const ROLLBACK_PATH =
  "docs/rls-drafts/order-payment-event-activation-rollback.sql";

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      "$1[redacted-credentials]@",
    );
}

async function readPosture(owner) {
  return (await owner.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      (SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.pg_policy AS policy
        WHERE policy.polrelid = class.oid) AS policy_count,
      pg_catalog.has_table_privilege($1, class.oid, 'SELECT') AS can_select,
      pg_catalog.has_table_privilege($1, class.oid, 'INSERT') AS can_insert,
      pg_catalog.has_table_privilege($1, class.oid, 'UPDATE') AS can_update,
      pg_catalog.has_table_privilege($1, class.oid, 'DELETE') AS can_delete,
      pg_catalog.has_table_privilege(
        $1, class.oid, 'TRUNCATE,REFERENCES,TRIGGER'
      ) AS has_other_table_authority,
      pg_catalog.has_function_privilege(
        $1,
        'public.grainline_blocked_checkout_refund_claim(text,bigint,text,text,integer)'::pg_catalog.regprocedure,
        'EXECUTE'
      ) AS can_execute_retired_claim,
      pg_catalog.has_function_privilege(
        $1,
        'public.grainline_case_seller_refund_apply(text,text)'::pg_catalog.regprocedure,
        'EXECUTE'
      ) AS can_execute_retired_case
    FROM pg_catalog.pg_class AS class
    WHERE class.oid = 'public."OrderPaymentEvent"'::pg_catalog.regclass
  `, [RUNTIME_ROLE])).rows[0];
}

const ACTIVATED = Object.freeze({
  rls_enabled: true,
  rls_forced: false,
  policy_count: 0,
  can_select: false,
  can_insert: false,
  can_update: false,
  can_delete: false,
  has_other_table_authority: false,
  can_execute_retired_claim: false,
  can_execute_retired_case: false,
});

const PREDECESSOR = Object.freeze({
  rls_enabled: false,
  rls_forced: false,
  policy_count: 0,
  can_select: true,
  can_insert: true,
  can_update: true,
  can_delete: true,
  has_other_table_authority: false,
  can_execute_retired_claim: true,
  can_execute_retired_case: true,
});

async function assertActivated(owner) {
  const snapshot =
    await readOrderPaymentEventActivationProductionSnapshotFromClient(owner, {
      runtimeRole: RUNTIME_ROLE,
    });
  assertOrderPaymentEventActivationProductionScope(snapshot, "after", {
    migrationRole: OWNER_ROLE,
    runtimeRole: RUNTIME_ROLE,
  });
  assert.deepEqual(await readPosture(owner), ACTIVATED);
}

async function proveRollbackRejectsDrift(owner, rollbackSql, driftSql) {
  await owner.query("BEGIN");
  let caught;
  try {
    await owner.query(driftSql);
    await owner.query(rollbackSql);
  } catch (error) {
    caught = error;
  }
  await owner.query("ROLLBACK");
  assert.equal(caught?.code, "P0001");
  assert.match(caught?.message ?? "", /rollback.*drifted/iu);
}

async function provePredecessorRuntimeBoundary(runtime) {
  const selected = await runtime.query(
    'SELECT pg_catalog.count(*)::integer AS count FROM public."OrderPaymentEvent"',
  );
  assert.equal(Number.isSafeInteger(selected.rows[0]?.count), true);
  const updated = await runtime.query(
    'UPDATE public."OrderPaymentEvent" SET id = id WHERE false',
  );
  const deleted = await runtime.query(
    'DELETE FROM public."OrderPaymentEvent" WHERE false',
  );
  assert.equal(updated.rowCount, 0);
  assert.equal(deleted.rowCount, 0);
}

export async function runOrderPaymentEventActivationRollbackProof(
  env = process.env,
) {
  const { ownerUrl, runtimeUrl } =
    parseOrderPaymentEventActivationProofConfig(env);
  verifyOrderPaymentEventActivationRelease();
  const rollbackSql = fs.readFileSync(ROLLBACK_PATH, "utf8");
  const activationSql = fs.readFileSync(
    `prisma/migrations/${ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION}/migration.sql`,
    "utf8",
  );
  const owner = new Client({ connectionString: ownerUrl });
  const runtime = new Client({ connectionString: runtimeUrl });
  await owner.connect();
  await runtime.connect();
  let restorationRequired = false;
  try {
    await assertActivated(owner);
    await proveRollbackRejectsDrift(
      owner,
      rollbackSql,
      'GRANT SELECT ON TABLE public."OrderPaymentEvent" TO PUBLIC',
    );
    await assertActivated(owner);
    await proveRollbackRejectsDrift(
      owner,
      rollbackSql,
      "GRANT EXECUTE ON FUNCTION public.grainline_order_payment_buyer_export_page(text,integer,bigint,text) TO PUBLIC",
    );
    await assertActivated(owner);

    restorationRequired = true;
    await owner.query(rollbackSql);
    assert.deepEqual(await readPosture(owner), PREDECESSOR);
    await provePredecessorRuntimeBoundary(runtime);

    await owner.query(activationSql);
    restorationRequired = false;
    await assertActivated(owner);
    return Object.freeze({
      directRuntimeLogin: true,
      publicTableDriftRejected: true,
      publicFunctionDriftRejected: true,
      predecessorTableCrudRestored: true,
      predecessorRetiredFunctionsRestored: 2,
      activationRestored: true,
      rowDataChanged: false,
      productionTouched: false,
    });
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    if (restorationRequired) {
      try {
        await owner.query(activationSql);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "OrderPaymentEvent rollback proof failed and activation restoration failed",
        );
      }
    }
    throw error;
  } finally {
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

async function main() {
  try {
    process.stdout.write(`${JSON.stringify(
      await runOrderPaymentEventActivationRollbackProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent activation rollback proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
