import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
  buildBlockedCheckoutRefundDeliveryMigration,
  verifyBlockedCheckoutRefundDeliveryMigrationBytes,
} from "../scripts/build-blocked-checkout-refund-delivery-migration.mjs";

const migrationPath = `prisma/migrations/${BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION}/migration.sql`;
const migration = readFileSync(migrationPath, "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("blocked-checkout refund delivery migration is byte-reproducible", () => {
  assert.equal(migration, buildBlockedCheckoutRefundDeliveryMigration());
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "5578678b745d41b57ec658a2363dea15728914c1b82e063bae1e3aea9ebbe25c",
  );
});

test("byte verification rejects a one-byte successor drift", () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "grainline-blocked-refund-delivery-"),
  );
  try {
    const sourceDirectory = path.join(
      root,
      "prisma/migrations/20260722051500_prepare_notification_rls",
    );
    const migrationDirectory = path.join(
      root,
      "prisma/migrations",
      BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
    );
    mkdirSync(sourceDirectory, { recursive: true });
    mkdirSync(migrationDirectory, { recursive: true });
    writeFileSync(
      path.join(sourceDirectory, "migration.sql"),
      readFileSync(
        "prisma/migrations/20260722051500_prepare_notification_rls/migration.sql",
        "utf8",
      ),
    );
    writeFileSync(
      path.join(migrationDirectory, "migration.sql"),
      `${migration}\n`,
    );
    assert.throws(
      () => verifyBlockedCheckoutRefundDeliveryMigrationBytes(root),
      /migration bytes drifted/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compatibility accepts predecessor and corrected refund notification types", () => {
  assert.match(
    migration,
    /localAction' = 'BLOCKED_CHECKOUT_REFUND_RECORDED'[\s\S]*?p_related_user_id IS NULL[\s\S]*?p_type IN \([\s\S]*?'NEW_ORDER'::public\."NotificationType",[\s\S]*?'REFUND_ISSUED'::public\."NotificationType"[\s\S]*?\)\)/,
  );
  assert.match(
    migration,
    /Compatibility window: predecessor deployments still emit[\s\S]*NEW_ORDER; the corrected application emits REFUND_ISSUED/,
  );
});

test("generic Notification authority stays private and table posture is unchanged", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.grainline_notification_create_core\([\s\S]*?FROM PUBLIC, grainline_app_runtime;/,
  );
  assert.match(
    migration,
    /has_function_privilege\(\s*'grainline_app_runtime', core_function, 'EXECUTE'\s*\)/,
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_notification_create_core/,
  );
  assert.doesNotMatch(
    migration,
    /ALTER TABLE|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY|GRANT (?:SELECT|INSERT|UPDATE|DELETE|ALL) ON/,
  );
});

test("CI applies the compatibility successor only after its sealed predecessors", () => {
  const verify = ciWorkflow.indexOf(
    "Verify blocked-checkout refund delivery compatibility release",
  );
  const isolate = ciWorkflow.indexOf(
    "Isolate blocked-checkout refund delivery until OrderPaymentEvent predecessors pass",
  );
  const predecessor = ciWorkflow.indexOf(
    "Apply Order refund inactive-seller recovery preparation",
  );
  const restore = ciWorkflow.indexOf(
    "Restore blocked-checkout refund delivery compatibility release",
  );
  const apply = ciWorkflow.indexOf(
    "Apply blocked-checkout refund delivery compatibility",
  );
  const proof = ciWorkflow.indexOf(
    "Prove predecessor and corrected blocked-checkout notification delivery",
  );

  for (const [label, index] of Object.entries({
    verify,
    isolate,
    predecessor,
    restore,
    apply,
    proof,
  })) {
    assert.ok(index >= 0, `${label} CI gate is missing`);
  }
  assert.ok(verify < isolate);
  assert.ok(isolate < predecessor);
  assert.ok(predecessor < restore);
  assert.ok(restore < apply);
  assert.ok(apply < proof);
  assert.match(
    ciWorkflow,
    /NOTIFICATION_RLS_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
});

test("PostgreSQL accepts the compatibility function and exact ACL verifier", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE TYPE public."NotificationType" AS ENUM (
        'NEW_ORDER',
        'REFUND_ISSUED'
      );
      SET check_function_bodies = off;
      CREATE FUNCTION public.grainline_notification_create_order_event(
        text, text, public."NotificationType", text, text, text
      ) RETURNS text
      LANGUAGE sql
      AS 'SELECT NULL::text';
      REVOKE ALL ON FUNCTION public.grainline_notification_create_order_event(
        text, text, public."NotificationType", text, text, text
      ) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.grainline_notification_create_order_event(
        text, text, public."NotificationType", text, text, text
      ) TO grainline_app_runtime;
    `);
    await database.exec(migration);
    const result = await database.query(`
      SELECT
        pg_catalog.strpos(
          pg_catalog.pg_get_functiondef(
            'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)'::regprocedure
          ),
          'REFUND_ISSUED''::public."NotificationType"'
        ) > 0 AS has_corrected_type,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text)',
          'EXECUTE'
        ) AS can_execute_core,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime',
          'public.grainline_notification_create_order_event(text,text,public."NotificationType",text,text,text)',
          'EXECUTE'
        ) AS can_execute_wrapper
    `);
    assert.deepEqual(result.rows[0], {
      has_corrected_type: true,
      can_execute_core: false,
      can_execute_wrapper: true,
    });
  } finally {
    await database.close();
  }
});
