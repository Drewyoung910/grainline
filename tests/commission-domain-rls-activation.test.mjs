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

const migration = readFileSync(
  "prisma/migrations/20261101070000_activate_commission_domain_rls/migration.sql",
  "utf8",
);
const rollback = readFileSync(
  "docs/rls-drafts/commission-domain-activation-rollback.sql",
  "utf8",
);
const provisioning = readFileSync(
  "scripts/provision-runtime-db-role.sql",
  "utf8",
);

test("Commission activation is an atomic policyless two-table boundary", () => {
  assert.match(migration, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(migration, /SET LOCAL statement_timeout = '60s'/u);
  assert.match(
    migration,
    /LOCK TABLE public\."CommissionRequest", public\."CommissionInterest"\s+IN ACCESS EXCLUSIVE MODE/u,
  );
  for (const table of ["CommissionRequest", "CommissionInterest"]) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" FORCE ROW LEVEL SECURITY`, "u"),
    );
  }
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE\s+public\."CommissionRequest", public\."CommissionInterest"\s+FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.equal((migration.match(/\bCREATE POLICY\b/gu) ?? []).length, 0);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});

test("runtime provisioning preserves predecessor compatibility and active zero-direct posture", () => {
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
    /\\if :grainline_commission_domain_rls_active[\s\S]*REVOKE ALL ON TABLE\s+public\."CommissionRequest",\s+public\."CommissionInterest"\s+FROM PUBLIC, :"runtime_role"/u,
  );
});

test("global grant audit recognizes the activated Commission domain", () => {
  const inventory = deriveGrantInventory();
  assert.equal(commissionDomainRlsActivationExpected(inventory), true);
  assert.equal(commissionDomainRlsForceExpected(inventory), true);
  assert.deepEqual(
    requiredRuntimeTablePrivileges("CommissionRequest", inventory),
    [],
  );
  assert.deepEqual(
    requiredRuntimeTablePrivileges("CommissionInterest", inventory),
    [],
  );
  const serviceTables = policylessServiceRlsTableNames(inventory);
  assert.equal(serviceTables.includes("CommissionRequest"), true);
  assert.equal(serviceTables.includes("CommissionInterest"), true);
});

test("Commission rollback atomically restores the predecessor posture", () => {
  const noForce = rollback.indexOf(
    'ALTER TABLE public."CommissionRequest" NO FORCE ROW LEVEL SECURITY',
  );
  const grant = rollback.indexOf(
    'GRANT SELECT, INSERT, UPDATE, DELETE',
  );
  assert.ok(noForce >= 0);
  assert.ok(grant > noForce);
  assert.match(rollback, /migrate resolve --rolled-back/u);
  assert.match(rollback, /20261101070000_activate_commission_domain_rls/u);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER)/iu);
});
