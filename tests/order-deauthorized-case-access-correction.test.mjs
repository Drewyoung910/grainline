import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildOrderDeauthorizedCaseAccessCorrection,
  BUYER_DETAIL_V3_SOURCE_SHA256,
  CASE_OPEN_PREDECESSOR_SOURCE_SHA256,
  DEAUTHORIZED_CASE_ACCESS_MIGRATION,
  extractFunctionSource,
  verifyOrderDeauthorizedCaseAccessCorrectionBytes,
} from "../scripts/build-order-deauthorized-case-access-correction.mjs";

const migrationPath =
  `prisma/migrations/${DEAUTHORIZED_CASE_ACCESS_MIGRATION}/migration.sql`;
const migration = fs.readFileSync(migrationPath, "utf8");
const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");

function functionDefinition(functionName, createMarker) {
  const marker = `${createMarker} public.${functionName}(`;
  const start = migration.indexOf(marker);
  const closing = `$${functionName}$;`;
  const end = migration.indexOf(closing, start);
  assert.ok(start >= 0 && end > start);
  return migration.slice(start, end + closing.length);
}

test("deauthorized Case-access correction is deterministic and additive", () => {
  assert.ok(
    DEAUTHORIZED_CASE_ACCESS_MIGRATION
      > "20260927090000_enable_order_rls",
  );
  assert.equal(migration, buildOrderDeauthorizedCaseAccessCorrection());
  assert.deepEqual(verifyOrderDeauthorizedCaseAccessCorrectionBytes(), {
    migration: DEAUTHORIZED_CASE_ACCESS_MIGRATION,
    migrationSha256:
      "e1bde08d46ed4b5927897b9b50ab3b26c01d5a380d35f6e74b0bcec8e34d4282",
  });
  assert.equal(migration.match(/^BEGIN;$/gmu)?.length, 1);
  assert.equal(migration.match(/^COMMIT;$/gmu)?.length, 1);
  assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY/iu);
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)\s+ON/iu,
  );
});

test("correction pins both predecessor functions and fixed runtime grants", () => {
  assert.match(migration, new RegExp(CASE_OPEN_PREDECESSOR_SOURCE_SHA256, "u"));
  assert.match(migration, new RegExp(BUYER_DETAIL_V3_SOURCE_SHA256, "u"));
  assert.match(
    migration,
    /has_function_privilege\(\s*'grainline_app_runtime',[\s\S]*'EXECUTE'/u,
  );
  assert.match(
    migration,
    /pg_get_userbyid\(routine\.proowner\) = current_user/u,
  );
  assert.match(migration, /acl\.grantee = 0/u);
  assert.match(
    migration,
    /timestamp\(3\) without time zone[\s\S]*Order_sellerDeauthorization_check/u,
  );
  assert.match(
    migration,
    /Order seller-deauthorization witness contract is missing/u,
  );
});

test("Case-open uses the durable witness without weakening label exclusion", () => {
  const source = extractFunctionSource(
    functionDefinition("grainline_case_open", "CREATE OR REPLACE FUNCTION"),
    "grainline_case_open",
  );
  assert.equal(
    source.match(/locked_order\."sellerDeauthorizedAt" IS NULL/gu)?.length,
    2,
  );
  assert.match(
    source,
    /"labelStatus" = 'PURCHASED'::public\."LabelStatus"[\s\S]*Case-open label purchase is active/u,
  );
  assert.match(source, /AND NOT locked_order\."reviewNeeded" THEN/u);
  assert.match(
    source,
    /window_reference_at \+ INTERVAL '30 days' < transition_at[\s\S]*locked_order\."sellerDeauthorizedAt" IS NOT NULL[\s\S]*'PENDING'::public\."FulfillmentStatus"/u,
  );
});

test("buyer v4 exposes only bounded Case-access decisions", () => {
  const source = extractFunctionSource(
    functionDefinition("grainline_order_buyer_detail_v4", "CREATE FUNCTION"),
    "grainline_order_buyer_detail_v4",
  );
  assert.match(
    source,
    /FROM public\.grainline_order_buyer_detail_v3\(p_actor_user_id, p_order_id\)/u,
  );
  assert.match(source, /source_order\."sellerDeauthorizedAt" IS NOT NULL/u);
  assert.match(
    source,
    /"labelStatus"::text IS NOT DISTINCT FROM 'PURCHASED'[\s\S]*"fulfillmentStatus"::text IS NOT DISTINCT FROM 'PENDING'/u,
  );
  assert.match(migration, /case_open_label_blocked boolean/u);
  assert.doesNotMatch(source, /"sellerDeauthorizationEventId"/u);
});

test("CI isolates the successor and proves its exact bytes after predecessors", () => {
  assert.match(
    workflow,
    /Verify Order deauthorized Case-access correction source package[\s\S]*Isolate Order deauthorized Case-access correction until predecessors pass/,
  );
  assert.match(
    workflow,
    /ORDER_DEAUTHORIZED_CASE_ACCESS_MIGRATION_PATH=\$correction\/migration\.sql/,
  );
  assert.match(
    workflow,
    /Restore Case refund label-claim correction[\s\S]*Apply only Case refund label-claim correction in disposable PostgreSQL[\s\S]*Restore Order deauthorized Case-access correction[\s\S]*Apply only Order deauthorized Case-access correction in disposable PostgreSQL/,
  );
  assert.match(
    workflow,
    /Apply only Order deauthorized Case-access correction in disposable PostgreSQL[\s\S]*--set=ON_ERROR_STOP=on[\s\S]*20260928010000_correct_order_deauthorized_case_access\/migration\.sql[\s\S]*Converge runtime grants after Order deauthorized Case-access correction[\s\S]*Prove Order deauthorized Case access through runtime login/,
  );
});
