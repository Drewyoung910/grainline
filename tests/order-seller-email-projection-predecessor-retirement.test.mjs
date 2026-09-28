import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("runtime role convergence retains only the email-free seller successors", () => {
  const analyticsGrant = provision.slice(
    provision.indexOf("WITH order_seller_analytics_authority(function_signature) AS (", provision.indexOf("WITH order_seller_analytics_authority(function_signature) AS (") + 1),
    provision.indexOf("-- Guild/service seller metrics"),
  );
  assert.doesNotMatch(analyticsGrant, /grainline_order_seller_recent_sales"\(text\)/);
  assert.match(analyticsGrant, /grainline_order_seller_recent_sales_v2"\(text\)/);

  const detailGrant = provision.slice(
    provision.indexOf("WITH order_participant_detail_projection_runtime"),
    provision.indexOf("-- Seller fulfillment"),
  );
  assert.doesNotMatch(detailGrant, /grainline_order_seller_detail_v[234]/);
  assert.match(detailGrant, /grainline_order_seller_detail_v5/);
});

test("application callers are already pinned to the email-free successors", () => {
  assert.match(detailAuthority, /grainline_order_seller_detail_v5/);
  assert.doesNotMatch(detailAuthority, /grainline_order_seller_detail_v[234]/);
  assert.match(analyticsAuthority, /grainline_order_seller_recent_sales_v2/);
  assert.doesNotMatch(analyticsAuthority, /grainline_order_seller_recent_sales\(/);
});
