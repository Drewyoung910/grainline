import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

export const PREREQUISITE_MIGRATION =
  "20261015020000_repair_immutable_order_refund_recording";
export const PREREQUISITE_CHECKSUM =
  "765d6d8bc128759dbc2710bfa856f1dd8b0c627efaabf43e3cab9c01ad9a9ebf";
export const CANDIDATE_MIGRATION =
  "20261015030000_preserve_blocked_checkout_refund_witness";

const summaryKeys = [
  "active_claim_order_count",
  "audit_log_order_count",
  "backfill_recorded_order_count",
  "backfill_required_order_count",
  "outstanding_with_refund_evidence_order_count",
  "projected_outstanding_order_count",
  "reconciliation_order_count",
  "recorded_event_order_count",
  "review_note_only_order_count",
  "review_note_order_count",
  "total_order_count",
].sort();

function queryBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} query must exist`);
  return source.slice(start + startMarker.length, end).trim().replace(/;$/u, "");
}

export function extractBlockedCheckoutWitnessInventoryQuery(source) {
  return queryBetween(source, "-- @query summary", "ROLLBACK;");
}

function assertAggregateInteger(value, label) {
  assert.match(String(value), /^(0|[1-9][0-9]*)$/u, `${label} must be nonnegative`);
}

export function assertPrivateSafeBlockedCheckoutWitnessInventory(summary) {
  assert.ok(summary && typeof summary === "object" && !Array.isArray(summary));
  assert.deepEqual(Object.keys(summary).sort(), summaryKeys);
  for (const key of summaryKeys) assertAggregateInteger(summary[key], key);
  assert.ok(
    BigInt(summary.backfill_recorded_order_count)
      <= BigInt(summary.backfill_required_order_count),
    "recorded witness count cannot exceed required witness count",
  );
  assert.equal(
    BigInt(summary.backfill_required_order_count),
    BigInt(summary.backfill_recorded_order_count)
      + BigInt(summary.projected_outstanding_order_count),
    "required witness count must partition into recorded and outstanding rows",
  );
  assert.ok(
    BigInt(summary.backfill_required_order_count) <= BigInt(summary.total_order_count),
    "required witness count cannot exceed total orders",
  );
  assert.ok(
    BigInt(summary.audit_log_order_count) <= BigInt(summary.backfill_required_order_count),
    "audit-log witness count cannot exceed required witnesses",
  );
  assert.ok(
    BigInt(summary.outstanding_with_refund_evidence_order_count)
      <= BigInt(summary.projected_outstanding_order_count),
    "already-refunded outstanding count cannot exceed outstanding witnesses",
  );
}

export async function executeBlockedCheckoutWitnessInventory(database, repositoryRoot) {
  const source = fs.readFileSync(path.join(
    repositoryRoot,
    "scripts/blocked-checkout-refund-witness-production-inventory.sql",
  ), "utf8");
  const query = extractBlockedCheckoutWitnessInventoryQuery(source);
  const rows = (await database.query(query)).rows;
  assert.equal(rows.length, 1, "inventory must emit exactly one aggregate row");
  assertPrivateSafeBlockedCheckoutWitnessInventory(rows[0]);
  return rows[0];
}

async function main() {
  assert.equal(
    process.env.BLOCKED_CHECKOUT_WITNESS_INVENTORY_CONFIRM,
    "read-only-blocked-checkout-refund-witness-inventory",
    "exact read-only inventory confirmation is required",
  );
  assert.match(
    process.env.BLOCKED_CHECKOUT_WITNESS_INVENTORY_RELEASE_COMMIT ?? "",
    /^[0-9a-f]{40}$/u,
    "exact inventory release commit is required",
  );
  assert.equal(
    process.env.BLOCKED_CHECKOUT_WITNESS_INVENTORY_RELEASE_COMMIT,
    process.env.GITHUB_SHA,
    "inventory release commit must equal the checked-out commit",
  );
  const outputPath = process.env.BLOCKED_CHECKOUT_WITNESS_INVENTORY_EVIDENCE_PATH;
  assert.ok(outputPath, "inventory evidence path is required");
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  let summary;
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
      SELECT migration_name, checksum, finished_at, rolled_back_at,
             applied_steps_count
        FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
       ORDER BY migration_name
    `, [[PREREQUISITE_MIGRATION, CANDIDATE_MIGRATION]])).rows;
    assert.equal(ledger.length, 1, "candidate must be pending and prerequisite unique");
    assert.equal(ledger[0].migration_name, PREREQUISITE_MIGRATION);
    assert.equal(ledger[0].checksum, PREREQUISITE_CHECKSUM);
    assert.ok(ledger[0].finished_at, "prerequisite migration must be finished");
    assert.equal(ledger[0].rolled_back_at, null);
    assert.equal(Number(ledger[0].applied_steps_count), 1);
    const objects = (await client.query(`
      SELECT
        pg_catalog.to_regclass('public."Order_blockedCheckoutRefundOutstanding_idx"')
          IS NOT NULL AS index_exists,
        pg_catalog.to_regprocedure(
          'public.grainline_order_blocked_checkout_refund_witness_immutable()'
        ) IS NOT NULL AS trigger_function_exists,
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_attribute AS attribute
           WHERE attribute.attrelid = 'public."Order"'::pg_catalog.regclass
             AND attribute.attname IN (
               'blockedCheckoutRefundRequiredAt',
               'blockedCheckoutRefundRecordedAt'
             )
             AND attribute.attnum > 0 AND NOT attribute.attisdropped
        ) AS columns_exist
    `)).rows[0];
    assert.deepEqual(objects, {
      index_exists: false,
      trigger_function_exists: false,
      columns_exist: false,
    }, "candidate objects must be absent before inventory");
    summary = await executeBlockedCheckoutWitnessInventory(client, repositoryRoot);
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
    await client.end();
  }
  fs.writeFileSync(outputPath, JSON.stringify({
    status: "passed",
    releaseCommit: process.env.BLOCKED_CHECKOUT_WITNESS_INVENTORY_RELEASE_COMMIT,
    prerequisiteMigration: PREREQUISITE_MIGRATION,
    candidateMigration: CANDIDATE_MIGRATION,
    summary,
  }), { mode: 0o600, flag: "wx" });
  process.stdout.write("Blocked-checkout witness aggregate inventory completed.\n");
}

if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
