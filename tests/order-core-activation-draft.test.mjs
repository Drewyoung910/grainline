import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildOrderCoreRlsCandidates } from "../scripts/build-order-core-rls-candidates.mjs";

const activation = readFileSync("docs/rls-drafts/order-core-activation.sql", "utf8");
const force = readFileSync("docs/rls-drafts/order-core-force.sql", "utf8");
const activationRollback = readFileSync(
  "docs/rls-drafts/order-core-activation-rollback.sql", "utf8");
const forceRollback = readFileSync(
  "docs/rls-drafts/order-core-force-rollback.sql", "utf8");

test("Core Order ENABLE is staged while FORCE stays a separate draft-only posture", () => {
  for (const source of [activation, force]) {
    assert.match(source, /^-- DRAFT ONLY\. Do not apply to any persistent database\./);
    assert.equal((source.match(/^BEGIN;$/gm) ?? []).length, 1);
    assert.equal((source.match(/^COMMIT;$/gm) ?? []).length, 1);
    assert.doesNotMatch(source, /\bCREATE\s+POLICY\b|\bGRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)\b/i);
    assert.doesNotMatch(source, /^ALTER TABLE public\."(?:OrderItem|OrderShippingRateQuote)"/m);
    assert.doesNotMatch(source, /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM)\b/im);
  }
  assert.match(activation, /^ALTER TABLE public\."Order" ENABLE ROW LEVEL SECURITY;$/m);
  assert.match(activation, /^ALTER TABLE public\."Order" NO FORCE ROW LEVEL SECURITY;$/m);
  assert.match(activation, /^REVOKE ALL ON TABLE public\."Order"\s+FROM PUBLIC, grainline_app_runtime;$/m);
  assert.doesNotMatch(activation, /^ALTER TABLE public\."Order" FORCE ROW LEVEL SECURITY;$/m);
  assert.match(activation, /accepted_staff_functions <> 6/);
  assert.match(activation, /child_count <> 2/);
  assert.match(force, /^ALTER TABLE public\."Order" FORCE ROW LEVEL SECURITY;$/m);
  assert.doesNotMatch(force, /^REVOKE\b|^ALTER TABLE public\."Order" ENABLE/m);
  assert.deepEqual(readdirSync("prisma/migrations").filter((name) =>
    /_(?:enable|force)_order_rls$/.test(name)), ["20260927090000_enable_order_rls"]);
});

test("Core Order rollback drafts reverse one posture at a time", () => {
  for (const source of [forceRollback, activationRollback]) {
    assert.match(source, /^-- DRAFT ONLY\. Do not apply to any persistent database\./);
    assert.equal((source.match(/^BEGIN;$/gm) ?? []).length, 1);
    assert.equal((source.match(/^COMMIT;$/gm) ?? []).length, 1);
    assert.doesNotMatch(source, /\bCREATE\s+POLICY\b/i);
    assert.doesNotMatch(source, /^ALTER TABLE public\."(?:OrderItem|OrderShippingRateQuote)"/m);
  }
  assert.match(forceRollback, /^ALTER TABLE public\."Order" NO FORCE ROW LEVEL SECURITY;$/m);
  assert.doesNotMatch(forceRollback, /^GRANT\b|^ALTER TABLE public\."Order" DISABLE/m);
  assert.match(activationRollback, /^ALTER TABLE public\."Order" DISABLE ROW LEVEL SECURITY;$/m);
  assert.match(activationRollback, /^GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\."Order"\s+TO grainline_app_runtime;$/m);
  assert.match(activationRollback, /child_count <> 2/);
  assert.doesNotMatch(activationRollback, /^ALTER TABLE public\."Order" NO FORCE/m);
});

test("Core Order review candidate pins the staged ENABLE bytes while FORCE remains unstaged", () => {
  const candidate = buildOrderCoreRlsCandidates();
  assert.match(candidate.enableMigration, /^-- Reviewed policyless Core Order ENABLE/m);
  assert.match(candidate.forceMigration, /^-- Reviewed posture-only Core Order FORCE/m);
  assert.deepEqual(readdirSync("prisma/migrations").filter((name) =>
    /_(?:enable|force)_order_rls$/.test(name)), ["20260927090000_enable_order_rls"]);
  assert.equal(
    readFileSync("prisma/migrations/20260927090000_enable_order_rls/migration.sql", "utf8"),
    candidate.enableMigration,
  );

  const disposable = mkdtempSync(join(tmpdir(), "grainline-order-core-candidate-"));
  try {
    cpSync("docs/rls-drafts", join(disposable, "docs/rls-drafts"), { recursive: true });
    const draft = join(disposable, "docs/rls-drafts/order-core-activation.sql");
    writeFileSync(draft, `${readFileSync(draft, "utf8")}\n-- unreviewed change\n`);
    assert.throws(() => buildOrderCoreRlsCandidates(disposable), /draft bytes or header drifted/);
  } finally {
    rmSync(disposable, { recursive: true, force: true });
  }
});
