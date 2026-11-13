import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  commissionDomainRlsActivationExpected,
  commissionDomainRlsForceExpected,
  deriveGrantInventory,
  policylessServiceRlsTableNames,
  requiredRuntimeTablePrivileges,
} from "../scripts/audit-runtime-db-grants.mjs";
import {
  privateTableRlsActivation,
  verifyPrivateTableRlsActivationSource,
} from "../scripts/private-table-rls-activation-catalog.mjs";

const migration = readFileSync(
  "prisma/migrations/20261113020000_activate_commission_domain_rls/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/commission-domain-activation-rollback.sql",
  "utf8",
);
const provisioning = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");

test("Commission activation is one atomic policyless two-table boundary", () => {
  const release = privateTableRlsActivation("commission_domain_v1");
  const verified = verifyPrivateTableRlsActivationSource("commission_domain_v1");
  assert.deepEqual(release.tables, ["CommissionRequest", "CommissionInterest"]);
  assert.equal(release.mode, "policyless_combined_enable_force");
  assert.deepEqual(release.policies, []);
  assert.equal(verified.migrationDigest, release.migrationSha256);
  assert.equal(verified.rollbackDigest, release.rollbackSha256);
  assert.match(migration, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(migration, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(
    migration,
    /LOCK TABLE public\."CommissionInterest", public\."CommissionRequest"\s+IN ACCESS EXCLUSIVE MODE/u,
  );
  for (const table of release.tables) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" FORCE ROW LEVEL SECURITY`, "u"),
    );
  }
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 0);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("runtime provisioning preserves zero-direct Commission authority after activation", () => {
  assert.match(
    provisioning,
    /Commission domain RLS is partially or unexpectedly configured; refusing runtime-role provisioning/u,
  );
  assert.match(
    provisioning,
    /COUNT\(\*\) = 2[\s\S]*relrowsecurity AND relforcerowsecurity AND policy_count = 0/u,
  );
  assert.match(
    provisioning,
    /\\if :grainline_commission_domain_rls_active[\s\S]*REVOKE ALL ON TABLE public\."CommissionInterest", public\."CommissionRequest"[\s\S]*FROM PUBLIC, :"runtime_role"/u,
  );
});

test("global grant audit recognizes the activated Commission domain", () => {
  const inventory = deriveGrantInventory();
  assert.equal(commissionDomainRlsActivationExpected(inventory), true);
  assert.equal(commissionDomainRlsForceExpected(inventory), true);
  for (const table of ["CommissionRequest", "CommissionInterest"]) {
    assert.deepEqual(requiredRuntimeTablePrivileges(table, inventory), []);
    assert.equal(policylessServiceRlsTableNames(inventory).includes(table), true);
  }
});

test("Commission rollback restores only the predecessor direct table posture", () => {
  for (const table of ["CommissionRequest", "CommissionInterest"]) {
    assert.match(
      rollback,
      new RegExp(`ALTER TABLE public\\."${table}" NO FORCE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      rollback,
      new RegExp(`ALTER TABLE public\\."${table}" DISABLE ROW LEVEL SECURITY`, "u"),
    );
  }
  assert.match(rollback, /Keep the successfully applied Prisma ledger row intact/u);
  assert.doesNotMatch(rollback, /migrate resolve --rolled-back/u);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});
