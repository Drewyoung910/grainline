import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";
import yaml from "js-yaml";
import {
  assertPrivateSafeBlockedCheckoutWitnessInventory,
  extractBlockedCheckoutWitnessInventoryQuery,
} from "../scripts/blocked-checkout-refund-witness-production-inventory.mjs";

const inventorySource = fs.readFileSync(
  "scripts/blocked-checkout-refund-witness-production-inventory.sql",
  "utf8",
);
const inventoryWorkflowSource = fs.readFileSync(
  ".github/workflows/blocked-checkout-refund-witness-inventory-production.yml",
  "utf8",
);
const productionWorkflowSource = fs.readFileSync(
  ".github/workflows/blocked-checkout-refund-witness-production.yml",
  "utf8",
);
const inventoryWorkflow = yaml.load(inventoryWorkflowSource, {
  schema: yaml.JSON_SCHEMA,
});
const productionWorkflow = yaml.load(productionWorkflowSource, {
  schema: yaml.JSON_SCHEMA,
});
const inventoryQuery = extractBlockedCheckoutWitnessInventoryQuery(inventorySource);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "refundClaimSource" text,
      "reviewNote" text
    );
    CREATE TABLE public."OrderRefundReconciliation" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      "claimSource" text NOT NULL
    );
    CREATE TABLE public."OrderPaymentEvent" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    INSERT INTO public."Order" (id, "refundClaimSource", "reviewNote") VALUES
      ('normal', NULL, NULL),
      ('claim', 'BLOCKED_CHECKOUT', NULL),
      ('note', NULL, 'Order was held for staff review.'),
      ('reconciliation', NULL, NULL),
      ('recorded', NULL, NULL),
      ('overlap', 'BLOCKED_CHECKOUT',
        'Later context. Order was held for staff review.');
    INSERT INTO public."OrderRefundReconciliation" (
      id, "orderId", "claimSource"
    ) VALUES
      ('reconciliation-row', 'reconciliation', 'BLOCKED_CHECKOUT'),
      ('overlap-row', 'overlap', 'BLOCKED_CHECKOUT');
    INSERT INTO public."OrderPaymentEvent" (id, "orderId", metadata) VALUES
      ('recorded-event', 'recorded',
        '{"localAction":"BLOCKED_CHECKOUT_REFUND_RECORDED"}'::jsonb),
      ('overlap-event', 'overlap',
        '{"localAction":"BLOCKED_CHECKOUT_REFUND_RECORDED"}'::jsonb);
  `);
  return database;
}

test("aggregate inventory mirrors the migration backfill and projected index population", async () => {
  const database = await createDatabase();
  try {
    const rows = (await database.query(inventoryQuery)).rows;
    assert.equal(rows.length, 1);
    const normalized = Object.fromEntries(Object.entries(rows[0]).map(
      ([key, value]) => [key, Number(value)],
    ));
    assert.deepEqual(normalized, {
      total_order_count: 6,
      active_claim_order_count: 2,
      review_note_order_count: 2,
      reconciliation_order_count: 2,
      recorded_event_order_count: 2,
      backfill_required_order_count: 5,
      backfill_recorded_order_count: 2,
      projected_outstanding_order_count: 3,
      review_note_only_order_count: 1,
    });
    assertPrivateSafeBlockedCheckoutWitnessInventory(rows[0]);
  } finally {
    await database.close();
  }
});

test("complete inventory script is read-only", async () => {
  const database = await createDatabase();
  try {
    const before = (await database.query(`
      SELECT count(*)::integer AS count FROM public."Order"
    `)).rows[0].count;
    await database.exec(inventorySource);
    const after = (await database.query(`
      SELECT count(*)::integer AS count FROM public."Order"
    `)).rows[0].count;
    assert.equal(after, before);
  } finally {
    await database.close();
  }
});

test("aggregate validation rejects identifiers and inconsistent counts", () => {
  const summary = {
    total_order_count: "6",
    active_claim_order_count: "2",
    review_note_order_count: "2",
    reconciliation_order_count: "2",
    recorded_event_order_count: "2",
    backfill_required_order_count: "5",
    backfill_recorded_order_count: "2",
    projected_outstanding_order_count: "3",
    review_note_only_order_count: "1",
  };
  assert.doesNotThrow(() =>
    assertPrivateSafeBlockedCheckoutWitnessInventory(summary));
  assert.throws(() => assertPrivateSafeBlockedCheckoutWitnessInventory({
    ...summary,
    order_id: "private-order-id",
  }));
  assert.throws(() => assertPrivateSafeBlockedCheckoutWitnessInventory({
    ...summary,
    projected_outstanding_order_count: "2",
  }), /partition/u);
});

test("inventory workflow is exact-main, protected, aggregate-only, and non-mutating", () => {
  assert.ok(inventoryWorkflow.on.workflow_dispatch);
  assert.equal(inventoryWorkflow.jobs.inspect.environment, "Production");
  assert.match(inventoryWorkflowSource,
    /run-read-only-blocked-checkout-refund-witness-inventory/u);
  assert.match(inventoryWorkflowSource, /production-database-inspections/u);
  assert.match(inventoryWorkflowSource,
    /blocked-checkout-refund-witness-production-inventory\.mjs/u);
  assert.doesNotMatch(inventoryWorkflowSource, /prisma migrate deploy/u);
  assert.doesNotMatch(inventoryWorkflowSource,
    /cat .*blocked-checkout-refund-witness-inventory/u);
});

test("migration workflow requires a successful same-commit inventory run", async () => {
  assert.ok(productionWorkflow.on.workflow_dispatch);
  assert.equal(productionWorkflow.jobs.apply.environment, "Production");
  assert.match(productionWorkflowSource,
    /apply-reviewed-blocked-checkout-refund-witness/u);
  assert.match(productionWorkflowSource,
    /REVIEWED_PENDING_MIGRATIONS: 20261015030000_preserve_blocked_checkout_refund_witness/u);
  assert.match(productionWorkflowSource, /run: npx prisma migrate deploy/u);
  const script = productionWorkflow.jobs.apply.steps.find((step) =>
    step.name ===
      "Bind release to exact main, completed push CI, and read-only inventory"
  ).with.script;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const sha = "a".repeat(40);
  const pushRuns = [
    [201, "CI", ".github/workflows/ci.yml"],
    [202, "Account Deletion Worker Bootstrap Proof",
      ".github/workflows/account-deletion-worker-bootstrap-proof.yml"],
    [203, "Order Staff Bootstrap Proof",
      ".github/workflows/order-staff-bootstrap-proof.yml"],
    [204, "Order Paid Repair Lock Proof",
      ".github/workflows/order-paid-repair-lock-proof.yml"],
    [205, "Order Account Deletion Concurrency Proof",
      ".github/workflows/order-account-deletion-concurrency-proof.yml"],
  ].map(([id, name, workflowPath]) => ({
    id,
    name,
    path: workflowPath,
    event: "push",
    head_branch: "main",
    head_sha: sha,
    status: "completed",
    conclusion: "success",
  }));
  let inventorySha = "b".repeat(40);
  const github = {
    rest: {
      repos: { getBranch: async () => ({ data: { commit: { sha } } }) },
      actions: {
        getWorkflowRun: async ({ run_id: runId }) => ({ data: runId === 101 ? {
          name: "CI", event: "push", head_branch: "main", head_sha: sha,
          status: "completed", conclusion: "success",
        } : {
          name: "Blocked Checkout Refund Witness Inventory Production",
          event: "workflow_dispatch", head_branch: "main", head_sha: inventorySha,
          run_attempt: 1, status: "completed", conclusion: "success",
        } }),
        listWorkflowRunsForRepo: () => {},
      },
    },
    paginate: async () => pushRuns,
  };
  const context = { sha, repo: { owner: "test", repo: "grainline" } };
  const environment = { env: {
    REVIEWED_RELEASE_COMMIT: sha,
    REVIEWED_MAIN_CI_RUN_ID: "101",
    REVIEWED_INVENTORY_RUN_ID: "102",
  } };
  await assert.rejects(
    new AsyncFunction("github", "context", "process", script)(
      github, context, environment,
    ),
    /inventory run drifted/u,
  );
  inventorySha = sha;
  await assert.doesNotReject(
    new AsyncFunction("github", "context", "process", script)(
      github, context, environment,
    ),
  );
});
