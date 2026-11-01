import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  privateTableRlsActivation,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";

const releaseId = "seller_analytics_daily_v1";

test("SellerAnalyticsDaily activation seals both tables and every FORCE-crossing function", () => {
  const release = privateTableRlsActivation(releaseId);
  const verified = verifyPrivateTableRlsActivationSource(releaseId);

  assert.equal(release.table, "ListingViewDaily");
  assert.deepEqual(release.additionalTables, ["SellerProfileViewDaily"]);
  assert.equal(release.mode, "policyless_combined_enable_force");
  assert.deepEqual(release.policies, []);
  assert.deepEqual(release.predecessorRuntimePrivileges, [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
  ]);
  assert.deepEqual(release.activatedRuntimePrivileges, []);
  assert.deepEqual(release.activatedStaffPrivileges, []);
  assert.deepEqual(release.activatedPublicPrivileges, []);
  assert.deepEqual(release.functionChanges.retained, [{
    name: "grainline_order_seller_analytics_top_listings",
    arguments: "text, bigint, bigint, boolean, boolean",
    sourceMd5: "195c87faa7dab7e74006f768b0a2e488",
    securityDefiner: true,
    predecessorExecuteRole: "runtime",
    activatedExecuteRole: "runtime",
  }]);
  assert.equal(verified.migrationDigest, release.migrationSha256);
  assert.equal(verified.rollbackDigest, release.rollbackSha256);
});

test("SellerAnalyticsDaily activation is one policyless authority transaction", () => {
  const verified = verifyPrivateTableRlsActivationSource(releaseId);
  const migration = readFileSync(verified.migrationPath, "utf8");
  const rollback = readFileSync(verified.rollbackPath, "utf8");

  assert.match(migration, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(migration, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(
    migration,
    /LOCK TABLE public\."ListingViewDaily", public\."SellerProfileViewDaily"\s+IN ACCESS EXCLUSIVE MODE/u,
  );
  for (const table of ["ListingViewDaily", "SellerProfileViewDaily"]) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" FORCE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`REVOKE ALL PRIVILEGES ON TABLE public\\."${table}"`, "u"),
    );
    assert.match(
      rollback,
      new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE[\\s\\S]*public\\."${table}"`, "u"),
    );
    assert.match(
      rollback,
      new RegExp(`ALTER TABLE public\\."${table}" NO FORCE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      rollback,
      new RegExp(`ALTER TABLE public\\."${table}" DISABLE ROW LEVEL SECURITY`, "u"),
    );
  }
  assert.doesNotMatch(migration, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("SellerAnalyticsDaily rollback is database-first and preserves compatible authorities", () => {
  const verified = verifyPrivateTableRlsActivationSource(releaseId);
  const rollback = readFileSync(verified.rollbackPath, "utf8");
  const rollbackProse = rollback.replace(/^-- ?/gmu, "");
  const firstGrant = rollback.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE");
  const firstDisable = rollback.indexOf("DISABLE ROW LEVEL SECURITY");

  assert.notEqual(firstGrant, -1);
  assert.notEqual(firstDisable, -1);
  assert.equal(firstGrant < firstDisable, true);
  assert.match(rollbackProse, /compatible fixed-operation\s+application remains live/u);
  assert.match(rollbackProse, /keep the successfully\s+applied Prisma ledger row intact/u);
  assert.match(rollbackProse, /newly reviewed forward\s+migration with a new name/u);
  assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
});

test("SellerAnalyticsDaily activation keeps the executed plan and race proof wired", () => {
  const scenario = readFileSync(
    new URL(
      "../tools/database-full-chain/scenarios/seller-analytics-daily-authorities.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const fullChain = readFileSync(
    new URL("./database-full-chain-postgres.test.mjs", import.meta.url),
    "utf8",
  );

  for (const behavior of [
    "proveSellerAnalyticsQueryPlans",
    "proveConcurrentViewAndClick",
    "proveListingDeleteRaces",
    "proveProfileDeletionRaces",
    "proveRetentionCascadeRaces",
    "proveOwnerReadsDuringWrites",
  ]) {
    assert.match(scenario, new RegExp(`async function ${behavior}\\b`, "u"));
  }
  assert.match(scenario, /EXPLAIN \(FORMAT JSON\)/u);
  assert.match(scenario, /waitForLockWait/u);
  assert.match(fullChain, /comprehensiveProof: true/u);
});
