import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  process.env.COMMISSION_DOMAIN_RLS_ACTIVATION_MIGRATION_PATH ??
    "prisma/migrations/20261113020000_activate_commission_domain_rls/migration.sql",
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

const TABLES = ["CommissionRequest", "CommissionInterest"];
const RETIRED = [
  "grainline_message_create_commission_interest",
  "grainline_direct_upload_sync_commission_request",
  "grainline_seller_service_commission_interest_targets",
];
const ACTIVATION_CHECKSUM =
  "b84685453deef07f43cce445982eb6f0859ac9ee59442b5d4f0302d87525664f";
const provisioningDecision = provisioning.match(
  /-- BEGIN COMMISSION_DOMAIN_PROVISIONING_DECISION\n([\s\S]*?)\n-- END COMMISSION_DOMAIN_PROVISIONING_DECISION/u,
)?.[1];

async function provisioningCase({ posture, ledgerRows }) {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE TABLE public._prisma_migrations (
        id text PRIMARY KEY,
        checksum text NOT NULL,
        finished_at timestamptz,
        migration_name text NOT NULL,
        rolled_back_at timestamptz,
        applied_steps_count integer NOT NULL DEFAULT 0
      );
      CREATE TABLE public."CommissionRequest" (id text PRIMARY KEY);
      CREATE TABLE public."CommissionInterest" (id text PRIMARY KEY);
    `);
    if (posture === "active") {
      await database.exec(`
        ALTER TABLE public."CommissionRequest" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public."CommissionRequest" FORCE ROW LEVEL SECURITY;
        ALTER TABLE public."CommissionInterest" ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public."CommissionInterest" FORCE ROW LEVEL SECURITY;
      `);
    }
    for (const [index, row] of ledgerRows.entries()) {
      await database.query(
        `INSERT INTO public._prisma_migrations (
           id, checksum, finished_at, migration_name, rolled_back_at,
           applied_steps_count
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          `row-${index}`,
          row.checksum ?? ACTIVATION_CHECKSUM,
          row.finishedAt ?? null,
          "20261113020000_activate_commission_domain_rls",
          row.rolledBackAt ?? null,
          row.appliedStepsCount ?? 0,
        ],
      );
    }
    assert.ok(provisioningDecision, "Commission provisioning decision SQL is missing");
    return (await database.query(provisioningDecision)).rows[0];
  } finally {
    await database.close();
  }
}

test("Commission activation is one policyless two-table boundary", () => {
  assert.match(migration, /^BEGIN;/mu);
  assert.match(migration, /SET LOCAL lock_timeout = '10s'/u);
  assert.match(
    migration,
    /LOCK TABLE public\."CommissionRequest", public\."CommissionInterest"\s+IN ACCESS EXCLUSIVE MODE/u,
  );
  for (const table of TABLES) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" ENABLE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\."${table}" FORCE ROW LEVEL SECURITY`, "u"),
    );
  }
  assert.doesNotMatch(migration, /CREATE\s+POLICY/iu);
  assert.doesNotMatch(migration, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER|POLICY)/iu);
});

test("Commission activation retires exactly the three superseded entry points", () => {
  const revoke = migration.match(
    /REVOKE ALL ON FUNCTION([\s\S]*?)FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;/u,
  )?.[1] ?? "";
  for (const name of RETIRED) assert.match(revoke, new RegExp(name, "u"));
  assert.equal(
    (revoke.match(/public\.grainline_/gu) ?? []).length,
    RETIRED.length,
  );
  assert.doesNotMatch(
    migration,
    /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*Commission/u,
  );
});

test("Commission rollback restores authorities before disabling RLS", () => {
  const grantTable = rollback.indexOf("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE");
  const grantFunctions = rollback.indexOf("GRANT EXECUTE ON FUNCTION");
  const disable = rollback.indexOf(
    'ALTER TABLE public."CommissionRequest" NO FORCE ROW LEVEL SECURITY',
  );
  assert.ok(grantTable >= 0 && grantFunctions > grantTable && disable > grantFunctions);
  for (const table of TABLES) {
    assert.match(
      rollback,
      new RegExp(`ALTER TABLE public\\."${table}" NO FORCE ROW LEVEL SECURITY`, "u"),
    );
    assert.match(
      rollback,
      new RegExp(`ALTER TABLE public\\."${table}" DISABLE ROW LEVEL SECURITY`, "u"),
    );
  }
  for (const name of RETIRED) assert.match(rollback, new RegExp(name, "u"));
  assert.match(rollback, /relation\.relowner = owner_oid/u);
  assert.match(rollback, /pg_catalog\.aclexplode/u);
  assert.match(rollback, /pg_catalog\.md5\(procedure\.prosrc\) = legacy\.source_md5/u);
  assert.match(rollback, /procedure\.proconfig = ARRAY\['search_path=pg_catalog'\]::text\[\]/u);
  assert.match(rollback, /acl\.grantee <> relation_state\.relowner/u);
  assert.match(rollback, /procedure\.prorettype = legacy\.return_type::pg_catalog\.regtype/u);
  assert.match(rollback, /'pg_catalog\.text'/u);
  assert.doesNotMatch(rollback, /acl\.grantee = relation_state\.relowner[\s\S]*acl\.is_grantable/u);
  assert.doesNotMatch(rollback, /acl\.grantee = procedure\.proowner[\s\S]*acl\.is_grantable/u);
  assert.match(rollback, /acl\.grantee = runtime_oid[\s\S]*acl\.privilege_type IN \('SELECT', 'INSERT', 'UPDATE', 'DELETE'\)[\s\S]*\) <> 4/u);
  assert.match(rollback, /global release audit deliberately[\s\S]*remains fail-closed/u);
  assert.doesNotMatch(rollback, /DROP\s+(?:TABLE|COLUMN|FUNCTION|TRIGGER|POLICY)/iu);
});

test("runtime provisioning converges retirement from exact ledger and posture", () => {
  assert.match(
    provisioning,
    /20261113020000_activate_commission_domain_rls/u,
  );
  assert.match(
    provisioning,
    /b84685453deef07f43cce445982eb6f0859ac9ee59442b5d4f0302d87525664f/u,
  );
  assert.match(
    provisioning,
    /invalid_count <> 0[\s\S]*success_count > 1[\s\S]*active AND success_count <> 1[\s\S]*success_count = 1 AND active[\s\S]*grainline_commission_domain_rls_active/u,
  );
  assert.match(
    provisioning,
    /\\if :grainline_commission_domain_rls_active[\s\S]*REVOKE ALL ON TABLE[\s\S]*REVOKE ALL ON FUNCTION/u,
  );
});

test("Commission provisioning executes the complete recovery ledger truth table", async () => {
  const success = Object.freeze({ finishedAt: "2026-11-19T12:00:00Z", appliedStepsCount: 1 });
  const rolledBack = Object.freeze({ rolledBackAt: "2026-11-19T12:01:00Z" });
  const expectedPass = (active) => ({
    grainline_role_provisioning_failed: false,
    grainline_role_provisioning_failure: "",
    grainline_commission_domain_rls_active: active,
  });
  const expectedFailure = {
    grainline_role_provisioning_failed: true,
    grainline_role_provisioning_failure:
      "Commission activation ledger or table posture drifted; refusing runtime-role provisioning",
    grainline_commission_domain_rls_active: false,
  };

  assert.deepEqual(
    await provisioningCase({ posture: "predecessor", ledgerRows: [] }),
    expectedPass(false),
  );
  assert.deepEqual(
    await provisioningCase({ posture: "active", ledgerRows: [success] }),
    expectedPass(true),
  );
  assert.deepEqual(
    await provisioningCase({ posture: "predecessor", ledgerRows: [success] }),
    expectedPass(false),
    "an applied-ledger emergency rollback must converge without reactivation",
  );
  for (const posture of ["active", "predecessor"]) {
    assert.deepEqual(
      await provisioningCase({ posture, ledgerRows: [success, success] }),
      expectedFailure,
      `duplicate successful ledger rows must fail closed in ${posture} posture`,
    );
  }
  assert.deepEqual(
    await provisioningCase({
      posture: "active",
      ledgerRows: [rolledBack, success],
    }),
    expectedPass(true),
    "a resolved exact attempt followed by one success is recoverable",
  );
  assert.deepEqual(
    await provisioningCase({ posture: "predecessor", ledgerRows: [{}] }),
    expectedFailure,
    "an unresolved exact attempt must fail closed",
  );
  assert.deepEqual(
    await provisioningCase({
      posture: "predecessor",
      ledgerRows: [{ ...success, checksum: "0".repeat(64) }],
    }),
    expectedFailure,
    "checksum drift must fail closed even when the row otherwise succeeded",
  );
});
