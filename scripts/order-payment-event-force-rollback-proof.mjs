#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  parseOrderPaymentEventActivationProofConfig,
} from "./order-payment-event-activation-postgres-proof.mjs";
import {
  assertOrderPaymentEventActivationProductionScope,
  readOrderPaymentEventActivationProductionSnapshotFromClient,
} from "./verify-order-payment-event-activation-production-scope.mjs";
import {
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
} from "./stage-order-payment-event-force-migration.mjs";
import {
  verifyOrderPaymentEventForceRelease,
} from "./verify-order-payment-event-force-release.mjs";

const { Client } = pg;
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const ROLLBACK_PATH =
  "docs/rls-drafts/order-payment-event-force-rollback.sql";

async function assertPosture(owner, expectedForce) {
  const snapshot =
    await readOrderPaymentEventActivationProductionSnapshotFromClient(owner, {
      runtimeRole: RUNTIME_ROLE,
    });
  const result = assertOrderPaymentEventActivationProductionScope(
    snapshot,
    "after",
    {
      migrationRole: OWNER_ROLE,
      runtimeRole: RUNTIME_ROLE,
      expectedForce,
    },
  );
  assert.equal(result.orderPaymentEventRlsForced, expectedForce);
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

export async function provePhaseARuntimeBoundary(runtime) {
  await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await runtime.query("SAVEPOINT order_payment_event_direct_select_probe");
    let caught;
    try {
      await runtime.query(
        'SELECT id FROM public."OrderPaymentEvent" LIMIT 1',
      );
    } catch (error) {
      caught = error;
      await runtime.query(
        "ROLLBACK TO SAVEPOINT order_payment_event_direct_select_probe",
      );
    }
    await runtime.query("RELEASE SAVEPOINT order_payment_event_direct_select_probe");
    assert.equal(caught?.code, "42501");
    const buyer = await runtime.query(`
      SELECT * FROM public.grainline_order_payment_buyer_export_page(
        $1, 1, NULL, NULL
      )
    `, ["missing-buyer"]);
    assert.equal(buyer.rowCount, 0);
    await runtime.query("ROLLBACK");
  } catch (error) {
    await runtime.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function runOrderPaymentEventForceRollbackProof(
  env = process.env,
) {
  const { ownerUrl, runtimeUrl } =
    parseOrderPaymentEventActivationProofConfig(env);
  verifyOrderPaymentEventForceRelease();
  const rollbackSql = fs.readFileSync(ROLLBACK_PATH, "utf8");
  const forceSql = fs.readFileSync(
    `prisma/migrations/${ORDER_PAYMENT_EVENT_FORCE_MIGRATION}/migration.sql`,
    "utf8",
  );
  const owner = new Client({ connectionString: ownerUrl });
  const runtime = new Client({ connectionString: runtimeUrl });
  await owner.connect();
  await runtime.connect();
  let restorationRequired = false;
  try {
    await assertPosture(owner, true);
    await proveRollbackRejectsDrift(
      owner,
      rollbackSql,
      'GRANT SELECT ON TABLE public."OrderPaymentEvent" TO PUBLIC',
    );
    await assertPosture(owner, true);

    restorationRequired = true;
    await owner.query(rollbackSql);
    await assertPosture(owner, false);
    await provePhaseARuntimeBoundary(runtime);

    await owner.query(forceSql);
    restorationRequired = false;
    await assertPosture(owner, true);
    return Object.freeze({
      directRuntimeLogin: true,
      publicTableDriftRejected: true,
      phaseARuntimeBoundaryPreserved: true,
      phaseARestoredDuringProof: true,
      forceRestored: true,
      rowDataChanged: false,
      productionTouched: false,
    });
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    if (restorationRequired) {
      try {
        await owner.query(forceSql);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          "OrderPaymentEvent FORCE rollback proof failed and restoration failed",
        );
      }
    }
    throw error;
  } finally {
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runOrderPaymentEventForceRollbackProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `OrderPaymentEvent FORCE rollback proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
