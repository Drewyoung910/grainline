import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

export const ORDER_REFUND_648_MIGRATION =
  "20261015020000_repair_immutable_order_refund_recording";
export const ORDER_REFUND_648_MIGRATION_CHECKSUM =
  "765d6d8bc128759dbc2710bfa856f1dd8b0c627efaabf43e3cab9c01ad9a9ebf";

const claimKeys = [
  "claim_cents",
  "claim_source",
  "claim_state",
  "inside_648_window",
  "orders",
  "provider_ledger_rows",
  "provider_refunded_cents",
  "provider_window",
  "repair_class",
  "source_event_failed_with_648",
].sort();
const lostClaimKeys = [
  "orders",
  "provider_refunded_cents",
  "refund_sentinel_cleared",
  "staff_case_refund_claim_in_flight",
].sort();

function queryBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} query must exist`);
  return source.slice(start + startMarker.length, end).trim().replace(/;$/u, "");
}

export function extractOrderRefund648InventoryQueries(source) {
  return {
    claimSummary: queryBetween(
      source,
      "-- @query claim-summary",
      "-- @query lost-claim-summary",
    ),
    lostClaimSummary: queryBetween(
      source,
      "-- @query lost-claim-summary",
      "ROLLBACK;",
    ),
  };
}

function assertAggregateInteger(value, label) {
  assert.match(String(value), /^(0|[1-9][0-9]*)$/u, `${label} must be nonnegative`);
}

function assertExactKeys(row, expected, label) {
  assert.deepEqual(Object.keys(row).sort(), expected, `${label} emitted unexpected fields`);
}

export function assertPrivateSafeOrderRefund648Inventory({
  claimSummary,
  lostClaimSummary,
}) {
  assert.ok(Array.isArray(claimSummary));
  assert.ok(Array.isArray(lostClaimSummary));
  for (const [index, row] of claimSummary.entries()) {
    const label = `claimSummary[${index}]`;
    assertExactKeys(row, claimKeys, label);
    assertAggregateInteger(row.orders, `${label}.orders`);
    assertAggregateInteger(row.claim_cents, `${label}.claim_cents`);
    assertAggregateInteger(
      row.provider_refunded_cents,
      `${label}.provider_refunded_cents`,
    );
    assertAggregateInteger(
      row.provider_ledger_rows,
      `${label}.provider_ledger_rows`,
    );
    assert.equal(typeof row.inside_648_window, "boolean");
    assert.equal(typeof row.source_event_failed_with_648, "boolean");
    for (const key of [
      "repair_class",
      "claim_source",
      "claim_state",
      "provider_window",
    ]) {
      assert.equal(typeof row[key], "string", `${label}.${key} must be text`);
      assert.ok(row[key].length <= 80, `${label}.${key} is unexpectedly long`);
    }
  }
  for (const [index, row] of lostClaimSummary.entries()) {
    const label = `lostClaimSummary[${index}]`;
    assertExactKeys(row, lostClaimKeys, label);
    assertAggregateInteger(row.orders, `${label}.orders`);
    assertAggregateInteger(
      row.provider_refunded_cents,
      `${label}.provider_refunded_cents`,
    );
    assert.equal(typeof row.refund_sentinel_cleared, "boolean");
    assert.equal(typeof row.staff_case_refund_claim_in_flight, "boolean");
  }
}

export async function executeOrderRefund648Inventory(database, repositoryRoot) {
  const source = fs.readFileSync(
    path.join(repositoryRoot, "scripts/order-refund-648-production-inventory.sql"),
    "utf8",
  );
  const queries = extractOrderRefund648InventoryQueries(source);
  const claimSummary = (await database.query(queries.claimSummary)).rows;
  const lostClaimSummary = (await database.query(queries.lostClaimSummary)).rows;
  const evidence = { claimSummary, lostClaimSummary };
  assertPrivateSafeOrderRefund648Inventory(evidence);
  return evidence;
}

async function main() {
  assert.equal(
    process.env.ORDER_REFUND_648_INVENTORY_CONFIRM,
    "read-only-order-refund-648-inventory",
    "exact read-only inventory confirmation is required",
  );
  assert.match(
    process.env.ORDER_REFUND_648_INVENTORY_RELEASE_COMMIT ?? "",
    /^[0-9a-f]{40}$/u,
    "exact inventory release commit is required",
  );
  assert.equal(
    process.env.ORDER_REFUND_648_INVENTORY_RELEASE_COMMIT,
    process.env.GITHUB_SHA,
    "inventory release commit must equal the checked-out commit",
  );
  const outputPath = process.env.ORDER_REFUND_648_INVENTORY_EVIDENCE_PATH;
  assert.ok(outputPath, "inventory evidence path is required");
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  let evidence;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
    const transaction = (await client.query(`
      SELECT current_setting('transaction_read_only') AS read_only
    `)).rows[0];
    assert.equal(transaction.read_only, "on", "inventory transaction must be read-only");
    const ledger = (await client.query(`
      SELECT checksum, finished_at, rolled_back_at, applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = $1
    `, [ORDER_REFUND_648_MIGRATION])).rows;
    assert.equal(ledger.length, 1, "#648 migration ledger row must exist exactly once");
    assert.equal(ledger[0].checksum, ORDER_REFUND_648_MIGRATION_CHECKSUM);
    assert.ok(ledger[0].finished_at, "#648 migration must be finished");
    assert.equal(ledger[0].rolled_back_at, null, "#648 migration must not be rolled back");
    assert.equal(Number(ledger[0].applied_steps_count), 1);
    evidence = await executeOrderRefund648Inventory(client, repositoryRoot);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {}
    await client.end();
  }
  fs.writeFileSync(outputPath, JSON.stringify({
    status: "passed",
    releaseCommit: process.env.ORDER_REFUND_648_INVENTORY_RELEASE_COMMIT,
    prerequisiteMigration: ORDER_REFUND_648_MIGRATION,
    ...evidence,
  }), { mode: 0o600, flag: "wx" });
  process.stdout.write("Order refund #648 aggregate-only inventory completed.\n");
}

if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
