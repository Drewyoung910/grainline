import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION,
  ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_SHA256,
  ORDER_ITEM_QUOTE_RUNTIME_LOCKED_TABLES,
  REQUIRED_TABLE_PRIVILEGES,
  readOrderItemQuoteRuntimeLockState,
  requiredRuntimeTablePrivileges,
} from "../scripts/audit-runtime-db-grants.mjs";

const migration = readFileSync(
  process.env.ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_PATH
    ?? "prisma/migrations/20260929130000_revoke_order_item_shipping_quote_runtime_access/migration.sql",
  "utf8",
);
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const productionWorkflow = readFileSync(
  ".github/workflows/order-item-quote-runtime-lock-production.yml",
  "utf8",
);

test("runtime lock removes only direct OrderItem and quote table authority", () => {
  assert.match(
    migration,
    /REVOKE ALL ON TABLE\s+public\."OrderItem",\s+public\."OrderShippingRateQuote"\s+FROM PUBLIC, grainline_app_runtime;/u,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:GRANT|DROP|CREATE|ALTER)\b|ROW LEVEL SECURITY|\bPOLICY\b|\bFUNCTION\b/iu,
  );
});

test("runtime provisioning preserves predecessor grants until the exact lock ledger", () => {
  assert.match(provision, new RegExp(ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION, "u"));
  assert.match(provision, new RegExp(ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_SHA256, "u"));
  assert.match(
    provision,
    /Order item\/quote runtime-lock ledger drifted; refusing runtime-role provisioning/u,
  );
  assert.match(
    provision,
    /\\if :grainline_order_item_quote_runtime_lock_applied[\s\S]*?REVOKE ALL ON TABLE\s+public\."OrderItem",\s+public\."OrderShippingRateQuote"\s+FROM PUBLIC, :"runtime_role";[\s\S]*?\\endif/u,
  );
  assert.match(provision, /\\unset grainline_order_item_quote_runtime_lock_applied/u);
  assert.match(
    ciWorkflow,
    /Stage only Order item and quote runtime lock for Prisma[\s\S]*?cp -a "prisma\/migrations\/\$migration" "\$isolated\/migrations\/\$migration"[\s\S]*?find "\$isolated\/migrations"[\s\S]*?= 1[\s\S]*?Apply only Order item and quote runtime lock through Prisma[\s\S]*?npx prisma migrate deploy --schema "\$ORDER_ITEM_QUOTE_RUNTIME_LOCK_PRISMA_SCHEMA"[\s\S]*?Converge runtime grants after Order item and quote runtime lock/u,
  );
  assert.doesNotMatch(ciWorkflow, /prisma migrate resolve/u);
});

test("grant audit changes expectations only after an exact completed ledger row", async () => {
  const absent = await readOrderItemQuoteRuntimeLockState({
    async query() {
      return { rows: [{ migration_table: null }] };
    },
  });
  assert.deepEqual(absent, { applied: false, issues: [] });

  const queries = [];
  const exact = await readOrderItemQuoteRuntimeLockState({
    async query(sql, parameters) {
      queries.push([sql, parameters]);
      if (queries.length === 1) {
        return { rows: [{ migration_table: "_prisma_migrations" }] };
      }
      return { rows: [{
        checksum: ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_SHA256,
        finished_at: new Date("2026-09-29T00:00:00Z"),
        rolled_back_at: null,
        applied_steps_count: "1",
      }] };
    },
  });
  assert.deepEqual(exact, { applied: true, issues: [] });
  assert.deepEqual(queries[1][1], [ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION]);

  for (const tableName of ORDER_ITEM_QUOTE_RUNTIME_LOCKED_TABLES) {
    assert.deepEqual(
      requiredRuntimeTablePrivileges(tableName, {
        orderItemQuoteRuntimeLockApplied: false,
      }),
      REQUIRED_TABLE_PRIVILEGES,
    );
    assert.deepEqual(
      requiredRuntimeTablePrivileges(tableName, {
        orderItemQuoteRuntimeLockApplied: true,
      }),
      [],
    );
  }

  const drifted = await readOrderItemQuoteRuntimeLockState({
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
      "Order item/quote runtime-lock migration ledger is partial or drifted",
    ],
  });
});

test("Production runtime lock is manual, exact-main, live-deployment and review bound", () => {
  assert.match(productionWorkflow, /workflow_dispatch:/u);
  assert.match(productionWorkflow, /production_deployment_id:/u);
  assert.match(
    productionWorkflow,
    /inputs\.confirmation == 'revoke-reviewed-order-item-quote-runtime-access'/u,
  );
  assert.match(productionWorkflow, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(productionWorkflow, /github\.run_attempt == 1/u);
  assert.match(productionWorkflow, /environment: Production/u);
  assert.match(productionWorkflow, /group: production-database-migrations/u);
  assert.match(
    productionWorkflow,
    /main\.commit\.sha !== sha[\s\S]*run\.head_sha !== sha[\s\S]*run\.conclusion !== 'success'/u,
  );
  assert.match(
    productionWorkflow,
    /Verify exact zero-direct deployment is live before revoking table access[\s\S]*node scripts\/verify-order-email-free-deployment-surface\.mjs/u,
  );
});

test("Production workflow admits only the exact latest reviewed migration", () => {
  assert.match(
    productionWorkflow,
    new RegExp(
      `${ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_SHA256}\\s+prisma/migrations/` +
        `${ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION}/migration\\.sql`,
      "u",
    ),
  );
  assert.match(
    productionWorkflow,
    new RegExp(`latest.*${ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION}`, "u"),
  );
  assert.match(
    productionWorkflow,
    /Require every predecessor applied and no other pending migration[\s\S]*npx prisma migrate status[\s\S]*Apply only the reviewed Order item and quote runtime lock/u,
  );
});

test("Production postflight closes only target grants and preserves Order authority posture", () => {
  assert.match(
    productionWorkflow,
    /Capture restart state and unchanged Order authority posture[\s\S]*pg_catalog\.aclexplode\(attribute\.attacl\)[\s\S]*assert\.deepEqual\(columnGrants\.rows, \[\]\)/u,
  );
  assert.match(
    productionWorkflow,
    /Read back exact ledger, closed grants, and unchanged authority posture[\s\S]*information_schema\.column_privileges[\s\S]*assert\.deepEqual\(columnGrants\.rows, \[\]\)/u,
  );
  assert.match(productionWorkflow, /assert\.deepEqual\(\(await client\.query\(grantsSql\)\)\.rows, \[\]\)/u);
  assert.match(productionWorkflow, /assert\.deepEqual\(\(await client\.query\(unrelatedGrantsSql\)\)\.rows,[\s\S]*before\.unrelatedGrants\)/u);
  assert.match(productionWorkflow, /assert\.deepEqual\(\(await client\.query\(definitionsSql\)\)\.rows,[\s\S]*before\.definitions\)/u);
  assert.match(productionWorkflow, /assert\.deepEqual\(\(await client\.query\(postureSql\)\)\.rows,[\s\S]*before\.posture\)/u);
  assert.doesNotMatch(productionWorkflow, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/u);
  assert.doesNotMatch(productionWorkflow, /vercel\s+(?:deploy|alias|promote)/iu);
});

test("CI holds the runtime lock until the seller-email retirement has passed", () => {
  const verify = ciWorkflow.indexOf(
    "Verify Order item and quote runtime-lock source package",
  );
  const isolate = ciWorkflow.indexOf(
    "Isolate Order item and quote runtime lock until its predecessors pass",
  );
  const predecessorApply = ciWorkflow.indexOf(
    "Apply only Order seller email-projection predecessor retirement in disposable PostgreSQL",
  );
  const staffIdentityRestore = ciWorkflow.indexOf(
    "Restore disposable staff-read identity for Core Order ENABLE",
  );
  const coreEnableApply = ciWorkflow.indexOf(
    "Apply accepted Core Order ENABLE predecessor in disposable PostgreSQL",
  );
  const restore = ciWorkflow.indexOf("Restore Order item and quote runtime lock");
  const stage = ciWorkflow.indexOf(
    "Stage only Order item and quote runtime lock for Prisma",
  );
  const runtimeLockApply = ciWorkflow.indexOf(
    "Apply only Order item and quote runtime lock through Prisma",
  );
  const grantAudit = ciWorkflow.indexOf(
    "Audit locked Order item and quote runtime grants",
  );
  const build = ciWorkflow.indexOf("Production build");
  assert.ok(verify > 0 && verify < isolate);
  assert.ok(isolate < predecessorApply);
  assert.ok(predecessorApply < staffIdentityRestore);
  assert.ok(staffIdentityRestore < coreEnableApply);
  assert.ok(coreEnableApply < restore);
  assert.ok(restore < stage);
  assert.ok(stage < runtimeLockApply);
  assert.ok(runtimeLockApply < grantAudit);
  assert.ok(grantAudit < build);
  assert.match(
    ciWorkflow,
    /ORDER_ITEM_QUOTE_RUNTIME_LOCK_MIGRATION_PATH=\$correction\/migration\.sql/u,
  );
  assert.match(
    ciWorkflow,
    /Restore disposable staff-read identity for Core Order ENABLE[\s\S]*?SELECT count\(\*\) FROM pg_catalog\.pg_roles WHERE rolname = 'grainline_staff_read_runtime'[\s\S]*?CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION[\s\S]*?provision-order-staff-read-role\.sql/u,
  );
});
