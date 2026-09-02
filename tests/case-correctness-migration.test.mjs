import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildCaseCorrectnessMigration,
  CASE_CORRECTNESS_MIGRATION,
  CASE_CORRECTNESS_MIGRATION_SHA256,
  verifyCaseCorrectnessMigrationBytes,
} from "../scripts/build-case-correctness-migration.mjs";

const migrationPath =
  `prisma/migrations/${CASE_CORRECTNESS_MIGRATION}/migration.sql`;
const migration = fs.readFileSync(migrationPath, "utf8");

function count(pattern) {
  return migration.match(pattern)?.length ?? 0;
}

test("Case correctness migration is deterministic and additive", () => {
  assert.equal(migration, buildCaseCorrectnessMigration());
  assert.deepEqual(verifyCaseCorrectnessMigrationBytes(), {
    migration: CASE_CORRECTNESS_MIGRATION,
    migrationSha256: CASE_CORRECTNESS_MIGRATION_SHA256,
  });
  assert.equal(count(/^BEGIN;$/gmu), 1);
  assert.equal(count(/^COMMIT;$/gmu), 1);
  assert.equal(count(/CREATE OR REPLACE FUNCTION public\./gu), 8);
  assert.equal(
    count(/CREATE OR REPLACE FUNCTION\s+public\./gu),
    9,
  );
  assert.equal(count(/REVOKE ALL ON FUNCTION/gu), 9);
  assert.equal(count(/GRANT EXECUTE ON FUNCTION/gu), 8);
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION\s+public\.grainline_case_seller_refund_apply/iu,
  );
  assert.doesNotMatch(migration, /ALTER TABLE[\s\S]*ROW LEVEL SECURITY/iu);
  assert.doesNotMatch(migration, /CREATE POLICY/iu);
  assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/iu);
});

test("money-path timestamps are explicit UTC timestamp-without-time-zone values", () => {
  assert.equal(
    count(/pg_catalog\.timezone\('UTC', pg_catalog\.clock_timestamp\(\)\)/gu),
    6,
  );
  assert.doesNotMatch(
    migration,
    /pg_catalog\.clock_timestamp\(\)::timestamp\(3\)/u,
  );
});

test("staff refund replay rechecks current authority before returning", () => {
  const prepareStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_prepare(",
  );
  const prepareEnd = migration.indexOf(
    "$grainline_case_staff_resolution_prepare$;",
    prepareStart,
  );
  const prepare = migration.slice(prepareStart, prepareEnd);
  const replayGuard = prepare.indexOf(
    "Case staff-resolution replay is no longer refund-eligible",
  );
  const replayReturn = prepare.indexOf("'action', 'replay'", replayGuard);
  assert.ok(replayGuard > 0 && replayReturn > replayGuard);
  assert.match(prepare, /locked_order\."paymentOpenDisputeBlocked"/u);
  assert.match(prepare, /locked_order\."labelStatus" = 'PURCHASED'/u);
  assert.match(prepare, /existing_claim\."orderPaymentEventId"/u);
  assert.match(prepare, /refund_event\."eventType" = 'REFUND'/u);
});

test("staff finalization cannot restore stock after fulfillment", () => {
  const finalizeStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.grainline_case_staff_resolution_finalize(",
  );
  const finalizeEnd = migration.indexOf(
    "$grainline_case_staff_resolution_finalize$;",
    finalizeStart,
  );
  const finalize = migration.slice(finalizeStart, finalizeEnd);
  const fulfillmentGuard = finalize.indexOf(
    "Case finalization cannot restore fulfilled stock",
  );
  const stockLoop = finalize.indexOf("FOR plan_entry IN", fulfillmentGuard);
  assert.ok(fulfillmentGuard > 0 && stockLoop > fulfillmentGuard);
  assert.match(finalize, /'SHIPPED'[\s\S]*'DELIVERED'[\s\S]*'PICKED_UP'/u);
});

test("legacy staff messages, dispute retention and deletion races fail closed", () => {
  assert.match(
    migration,
    /WHEN page\."authorId" = page\."sellerId"[\s\S]*ELSE 'STAFF'::text/u,
  );
  assert.match(
    migration,
    /order_row\."reviewNeeded" = false\s+AND order_row\."paymentOpenDisputeBlocked" = false/u,
  );

  const deletionStart = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.grainline_case_account_deletion_redact(",
  );
  const deletionEnd = migration.indexOf(
    "$grainline_case_account_deletion_redact$;",
    deletionStart,
  );
  const deletion = migration.slice(deletionStart, deletionEnd);
  assert.match(
    deletion,
    /seller\.id = order_row\."sellerProfileId"\s+AND seller\."userId" = locked_user\.id/u,
  );
  assert.doesNotMatch(
    deletion,
    /JOIN public\."Listing" AS listing ON listing\.id = item\."listingId"/u,
  );
  const orderLocks = deletion.indexOf('FOR UPDATE OF order_row;');
  const finalCaseCheck = deletion.indexOf(
    "SELECT pg_catalog.count(*)::bigint",
    orderLocks,
  );
  assert.ok(orderLocks > 0 && finalCaseCheck > orderLocks);
  assert.match(deletion, /ORDER BY order_row\.id\s+FOR UPDATE OF order_row/u);
});

test("migration rejects unknown predecessor bodies and verifies corrected bodies", () => {
  assert.match(migration, /Predecessor Case correctness function % drifted/u);
  assert.match(migration, /Corrected Case correctness function % drifted/u);
  assert.equal(count(/source_sha256/gu), 4);
  assert.equal(count(/pg_catalog\.to_regprocedure\(expected\.identity\)/gu), 2);
  assert.match(migration, /Predecessor Case function % grant posture drifted/u);
  assert.match(migration, /Corrected Case function % grant posture drifted/u);
  assert.match(
    migration,
    /grainline_case_seller_refund_apply\(text,text\)'[^\n]*false/u,
  );
});

test("retired seller-refund Case authority stays retired after body correction", () => {
  const audit = fs.readFileSync("scripts/audit-runtime-db-grants.mjs", "utf8");
  const activationCatalog = fs.readFileSync(
    "scripts/order-payment-event-activation-catalog.mjs",
    "utf8",
  );
  const provisioning = fs.readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

  assert.match(
    activationCatalog,
    /ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES[\s\S]*grainline_case_seller_refund_apply/u,
  );
  assert.match(
    audit,
    /ORDER_PAYMENT_EVENT_RETIRED_RUNTIME_FUNCTION_IDENTITIES\.map/u,
  );
  assert.match(
    provisioning,
    /retired_order_payment_event_service[\s\S]*grainline_case_seller_refund_apply/u,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION\s+public\.grainline_case_seller_refund_apply\(text, text\)\s+FROM PUBLIC, grainline_app_runtime;/u,
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION\s+public\.grainline_case_seller_refund_apply/u,
  );
});
