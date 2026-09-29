import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORDER_SELLER_EMAIL_PROJECTION_RETIRED_RUNTIME_FUNCTION_NAMES,
  ORDER_SELLER_EMAIL_PROJECTION_RETIREMENT_MIGRATION,
  ORDER_SELLER_EMAIL_PROJECTION_RETIREMENT_MIGRATION_SHA256,
  readOrderSellerEmailProjectionRetirementState,
  runtimePrivateFunctionNames,
} from "../scripts/audit-runtime-db-grants.mjs";

const migration = readFileSync(
  "prisma/migrations/20260928220000_retire_seller_buyer_email_projection_predecessors/migration.sql",
  "utf8",
);
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const detailAuthority = readFileSync("src/lib/orderParticipantDetailAuthority.ts", "utf8");
const analyticsAuthority = readFileSync("src/lib/orderSellerAnalyticsAuthority.ts", "utf8");

test("seller email-bearing predecessor projections lose ordinary runtime execution", () => {
  for (const identity of [
    "grainline_order_seller_detail_v2\\(text, text\\)",
    "grainline_order_seller_detail_v3\\(text, text\\)",
    "grainline_order_seller_detail_v4\\(text, text\\)",
    "grainline_order_seller_recent_sales\\(text\\)",
  ]) {
    assert.match(
      migration,
      new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${identity}\\s+FROM grainline_app_runtime`),
    );
  }
  assert.doesNotMatch(migration, /DROP FUNCTION|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/);
});

test("runtime role convergence preserves overlap until exact retirement", () => {
  assert.match(provision, /20260928220000_retire_seller_buyer_email_projection_predecessors/);
  assert.match(provision, /3a1f173fac0293ec05c43b44e9cd2a6895dcdd47effce55236e7e7c7a55fb799/);
  assert.match(
    provision,
    /seller email-projection retirement ledger drifted; refusing runtime-role provisioning/,
  );
  assert.match(
    provision,
    /order_seller_analytics_authority\(function_signature, predecessor\)[\s\S]*?NOT predecessor[\s\S]*?grainline_seller_email_projection_retirement_applied/,
  );
  assert.match(
    provision,
    /order_participant_detail_projection_runtime\(function_signature, predecessor\)[\s\S]*?NOT predecessor[\s\S]*?grainline_seller_email_projection_retirement_applied/,
  );
  assert.match(provision, /\\unset grainline_seller_email_projection_retirement_applied/);
  const analyticsGrant = provision.slice(
    provision.indexOf("WITH order_seller_analytics_authority(function_signature, predecessor) AS ("),
    provision.indexOf("-- Guild/service seller metrics"),
  );
  assert.match(analyticsGrant, /grainline_order_seller_recent_sales"\(text\).*true/);
  assert.match(analyticsGrant, /grainline_order_seller_recent_sales_v2"\(text\)/);

  const detailGrant = provision.slice(
    provision.indexOf("WITH order_participant_detail_projection_runtime"),
    provision.indexOf("-- Seller fulfillment"),
  );
  assert.match(detailGrant, /grainline_order_seller_detail_v2.*true/);
  assert.match(detailGrant, /grainline_order_seller_detail_v3.*true/);
  assert.match(detailGrant, /grainline_order_seller_detail_v4.*true/);
  assert.match(detailGrant, /grainline_order_seller_detail_v5/);
});

test("grant audit derives retired predecessors only from the exact live ledger", async () => {
  const absent = await readOrderSellerEmailProjectionRetirementState({
    async query() {
      return { rows: [{ migration_table: null }] };
    },
  });
  assert.deepEqual(absent, { applied: false, issues: [] });

  const queries = [];
  const exact = await readOrderSellerEmailProjectionRetirementState({
    async query(sql, parameters) {
      queries.push([sql, parameters]);
      if (queries.length === 1) {
        return { rows: [{ migration_table: "_prisma_migrations" }] };
      }
      return { rows: [{
        checksum: ORDER_SELLER_EMAIL_PROJECTION_RETIREMENT_MIGRATION_SHA256,
        finished_at: new Date("2026-09-29T00:00:00Z"),
        rolled_back_at: null,
        applied_steps_count: "1",
      }] };
    },
  });
  assert.deepEqual(exact, { applied: true, issues: [] });
  assert.deepEqual(queries[1][1], [
    ORDER_SELLER_EMAIL_PROJECTION_RETIREMENT_MIGRATION,
  ]);
  const privateNames = runtimePrivateFunctionNames({
    orderSellerEmailProjectionRetirementApplied: true,
  });
  for (const functionName of
    ORDER_SELLER_EMAIL_PROJECTION_RETIRED_RUNTIME_FUNCTION_NAMES) {
    assert.equal(privateNames.includes(functionName), true, functionName);
  }

  const drifted = await readOrderSellerEmailProjectionRetirementState({
    queryCount: 0,
    async query() {
      this.queryCount += 1;
      return this.queryCount === 1
        ? { rows: [{ migration_table: "_prisma_migrations" }] }
        : { rows: [{
          checksum: "0".repeat(64),
          finished_at: null,
          rolled_back_at: null,
          applied_steps_count: "0",
        }] };
    },
  });
  assert.deepEqual(drifted, {
    applied: false,
    issues: [
      "Order seller email-projection retirement migration ledger is partial or drifted",
    ],
  });
});

test("application callers are already pinned to the email-free successors", () => {
  assert.match(detailAuthority, /grainline_order_seller_detail_v5/);
  assert.doesNotMatch(detailAuthority, /grainline_order_seller_detail_v[234]/);
  assert.match(analyticsAuthority, /grainline_order_seller_recent_sales_v2/);
  assert.doesNotMatch(analyticsAuthority, /grainline_order_seller_recent_sales\(/);
});
