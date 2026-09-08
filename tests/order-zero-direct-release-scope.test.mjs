import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createOrderZeroDirectReleaseScope } from "../scripts/order-zero-direct-release-scope.mjs";
import { createCorrectionReleasePackage, CORRECTION_RELEASE_LEDGER_QUERY } from "../scripts/order-correction-release-package.mjs";
import { correctionProofAppliedRow, correctionProofHistoricalLedger } from "../scripts/order-correction-release-package-postgres-proof.mjs";
import { parseZeroDirectScopeProofConfig } from "../scripts/order-zero-direct-release-scope-postgres-proof.mjs";
import { expectedZeroDirectSchema } from "../scripts/order-zero-direct-release-schema.mjs";
import { createZeroDirectSchemaBase, applyZeroDirectSchemaMember } from "./helpers/order-zero-direct-schema-fixture.mjs";
import { zeroDirectRoleFixture } from "./helpers/order-zero-direct-role-fixture.mjs";

const scope = createOrderZeroDirectReleaseScope();
const correction = createCorrectionReleasePackage();
const full = correction.manifest.predecessor.map(r => correctionProofAppliedRow(r.migration_name, r.checksum));
const history = correctionProofHistoricalLedger(full, correction.manifest);
function ledger(n = 17) {
  const pending = new Set(scope.manifest.members.slice(n).map(r => r.migration_name));
  return structuredClone(history.filter(r => !pending.has(r.migration_name)));
}
function snapshot(n = 17) {
  return {
    identity: { database: "neondb", actor: "neondb_owner", login: "neondb_owner", read_only: "on", isolation: "repeatable read" },
    ledgerRows: ledger(n),
    schema: expectedZeroDirectSchema(n),
    roles: zeroDirectRoleFixture(),
    functions: scope.manifest.states[n].map(d => ({ name: d.name, identity_matches: true, owner: "neondb_owner",
      body: d.definition.split(/\nAS \$[A-Za-z0-9_]*\$/u)[1].replace(/\$[A-Za-z0-9_]*\$;$/u, ""),
      language: d.language, security_definer: d.securityDefiner, configuration: d.configuration,
      kind: "f", leakproof: false, strict: false, volatility: d.volatility, parallel_safety: d.parallelSafety,
      return_type: d.returnType, returns_set: d.returnsSet, arg_names: d.argNames, arg_modes: d.argModes,
      argument_defaults: 0, variadic: false, runtime_execute: d.runtimeExecute, staff_execute: false, invalid_acl_count: 0 })),
    tables: [ { name: "CheckoutStockReservation", kind: "r", owner: "neondb_owner", rls: true, force: true, policies: 0,
      runtime_privileges: [], invalid_acl_count: 0,
      invalid_column_acl_count: 0, runtime_column_extras: 0, staff_access: false },
    { name: "Order", kind: "r", owner: "neondb_owner", rls: false, force: false, policies: 0,
      runtime_privileges: ["DELETE", "INSERT", "SELECT", "UPDATE"], invalid_acl_count: 0,
      invalid_column_acl_count: 0, runtime_column_extras: 0, staff_access: false },
    ...[["OrderStaffCapability", 10], ["SellerDeauthorizationApplication", 12]].filter(([, i]) => n >= i).map(([name]) => ({
      name, kind: "r", owner: "neondb_owner", rls: true, force: true, policies: 0, runtime_privileges: [],
      invalid_acl_count: 0, invalid_column_acl_count: 0, runtime_column_extras: 0, staff_access: false })) ],
  };
}

test("exact 234 predecessors and 17 members produce all 18 bounded restart plans", () => {
  assert.equal(scope.manifest.base.length, 234);
  assert.equal(scope.manifest.targetNames.length, 36);
  assert.equal(Object.isFrozen(scope.manifest.states[0][0]), true);
  for (let n = 0; n <= 17; n += 1) {
    const s = snapshot(n); const result = scope.assertSnapshot(s, "restart"); const plan = scope.plan(s);
    assert.equal(result.prefixLength, n);
    assert.equal(result.productionExecutionAuthorized, false);
    assert.equal(result.completeProductionScope, false);
    assert.deepEqual(plan.remainingMigrations, scope.manifest.members.slice(n));
    assert.equal(plan.steps.includes("apply-only-remaining-prefix"), n < 17);
    assert.ok(plan.steps.includes("converge-reviewed-runtime-grants"));
    assert.ok(plan.steps.includes("global-grant-and-RLS-audit"));
    assert.ok(plan.pendingExternalGates.length >= 5);
  }
  scope.assertSnapshot(snapshot(0), "before"); scope.assertSnapshot(snapshot(), "after");
  assert.throws(() => scope.assertSnapshot(snapshot(1), "before"));
  assert.throws(() => scope.assertSnapshot(snapshot(16), "after"));
  assert.throws(() => scope.assertSnapshot(snapshot(), "apply"));
  assert.throws(() => scope.assertSnapshot(snapshot(), "restart", "bypass"));
});

test("every predecessor and selected member rejects missing, duplicate, checksum and status drift", () => {
  for (const row of history.filter(r => r.rolled_back_at === null)) for (const change of [
    rows => rows.splice(rows.findIndex(r => r.migration_name === row.migration_name), 1),
    rows => rows.push(structuredClone(row)),
    rows => { rows.find(r => r.migration_name === row.migration_name).checksum = "0".repeat(64); },
    rows => { rows.find(r => r.migration_name === row.migration_name).finished_at = null; },
    rows => { rows.find(r => r.migration_name === row.migration_name).applied_steps_count = 0; },
  ]) {
    const rows = ledger(); change(rows);
    // Removing the last member is a valid restart, but not an after state.
    assert.throws(() => scope.classify(rows, "after"));
  }
  for (let n = 0; n < 16; n += 1) {
    const rows = ledger(n); const next = scope.manifest.members[n + 1];
    rows.push(correctionProofAppliedRow(next.migration_name, next.checksum));
    assert.throws(() => scope.classify(rows, "restart"));
  }
  for (const pkg of correction.manifest.packages) {
    assert.throws(() => scope.classify([...ledger(), correctionProofAppliedRow(pkg.migration_name, pkg.checksum)], "restart"));
  }
  assert.throws(() => scope.classify([...ledger(), correctionProofAppliedRow("20990101000000_unknown", "0".repeat(64))], "restart"));
  for (const value of [undefined, {}, null]) assert.throws(() => scope.classify(value, "restart"));
});

test("historical exceptions cannot turn into generic failed-row admission", () => {
  assert.throws(() => scope.classify(full, "after"));
  for (const [i, row] of history.entries()) if (row.rolled_back_at !== null) for (const patch of [
    { checksum: "0".repeat(64) }, { applied_steps_count: 1 }, { finished_at: new Date() }, { rolled_back_at: null },
  ]) { const rows = ledger(); Object.assign(rows[i], patch); assert.throws(() => scope.classify(rows, "restart")); }
});

test("all states bind actual bodies, overloads, metadata and restricted execution", () => {
  for (let n = 0; n <= 17; n += 1) {
    const s = snapshot(n);
    for (let i = 0; i < s.functions.length; i += 1) {
      for (const patch of [ { body: "changed" }, { identity_matches: false }, { owner: "grainline_app_runtime" },
        { language: "c" }, { configuration: ["search_path=public"] }, { security_definer: false },
        { kind: "p" }, { strict: true }, { leakproof: true }, { volatility: "unexpected" }, { parallel_safety: "unexpected" },
        { return_type: "unexpected" }, { returns_set: !s.functions[i].returns_set }, { arg_names: ["renamed"] },
        { arg_modes: ["b"] }, { argument_defaults: 1 }, { variadic: true }, { staff_execute: true },
        { runtime_execute: !s.functions[i].runtime_execute }, { invalid_acl_count: 1 },
      ]) { const drift = structuredClone(s); Object.assign(drift.functions[i], patch); assert.throws(() => scope.assertSnapshot(drift, "restart")); }
    }
    const overload = structuredClone(s); overload.functions.push(overload.functions[0]);
    assert.throws(() => scope.assertSnapshot(overload, "restart"));
    if (n < 17) { const drift = structuredClone(s); drift.functions = snapshot(n + 1).functions;
      // A constraint-only member legitimately keeps the same function state.
      if (JSON.stringify(drift.functions) !== JSON.stringify(s.functions)) assert.throws(() => scope.assertSnapshot(drift, "restart")); }
  }
});

test("Order retains exact CRUD and private relations cannot appear early or acquire access", () => {
  for (const n of [0, 9, 10, 11, 12, 17]) {
    const s = snapshot(n);
    for (const patch of [{ kind: "p" }, { rls: true }, { force: true }, { policies: 1 }, { staff_access: true },
      { runtime_column_extras: 1 }, { invalid_acl_count: 1 }, { invalid_column_acl_count: 1 }, { runtime_privileges: ["SELECT"] },
      { runtime_privileges: ["DELETE", "INSERT", "SELECT", "TRUNCATE", "UPDATE"] }]) {
      const drift = structuredClone(s); Object.assign(drift.tables[1], patch); assert.throws(() => scope.assertSnapshot(drift, "restart"));
    }
    for (const i of [0, ...s.tables.map((_, i) => i).filter(i => i >= 2)]) for (const patch of [{ rls: false }, { force: false },
      { policies: 1 }, { runtime_privileges: ["SELECT"] }, { staff_access: true }]) {
      const drift = structuredClone(s); Object.assign(drift.tables[i], patch); assert.throws(() => scope.assertSnapshot(drift, "restart"));
    }
    const drift = structuredClone(s); drift.tables.push({ ...snapshot().tables[2], name: "unexpected" });
    assert.throws(() => scope.assertSnapshot(drift, "restart"));
  }
});

test("read-only transaction and identity failures stop before reading catalog data and always roll back", async () => {
  for (const patch of [{ read_only: "off" }, { isolation: "read committed" }, { actor: "ci" }, { login: "ci" }, { database: "other" }]) {
    const calls = []; const client = { query: async sql => { calls.push(sql);
      return { rows: [{ ...snapshot().identity, ...patch }] }; } };
    await assert.rejects(scope.readSnapshot(client, "restart"));
    assert.equal(calls[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    assert.equal(calls.at(-1), "ROLLBACK"); assert.equal(calls.length, 3);
  }
  const source = readFileSync("scripts/order-zero-direct-release-scope.mjs", "utf8");
  assert.doesNotMatch(source, /new (?:pg\.)?Client|writeFile|execFile|process\.env|ALTER ROLE|GRANT EXECUTE/u);
  assert.match(source, /proargmodes::text\[\]/u);
});

test("native proof accepts only the disposable loopback owner and does not wire production workflows", () => {
  const url = "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable";
  const parse = value => parseZeroDirectScopeProofConfig({ ORDER_ZERO_DIRECT_RELEASE_SCOPE_PROOF_DATABASE_URL: value });
  assert.equal(parse(url).databaseUrl, url);
  for (const value of [undefined, url.replace("localhost", "prod.neon.tech"), url.replace("grainline_ci", "neondb"),
    url.replace("//ci:", "//neondb_owner:"), url + "&host=other", url + "#other"]) assert.throws(() => parse(value));
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(workflow.indexOf("Prove exact zero-direct release catalog") > workflow.indexOf("Converge Order participant runtime grants"));
  for (const path of [".github/workflows/production-migrations.yml", ".github/workflows/order-compatible-production.yml"])
    assert.doesNotMatch(readFileSync(path, "utf8"), /order-zero-direct-release-scope/u);
});

test("real offline catalog decoding covers every state; schemas and identity are explicitly modeled", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE ci SUPERUSER LOGIN CREATEDB CREATEROLE REPLICATION BYPASSRLS;
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
      CREATE ROLE grainline_direct_upload_cleanup_v2 LOGIN NOINHERIT NOBYPASSRLS;
      CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT NOBYPASSRLS;
      SET SESSION AUTHORIZATION ci; SET check_function_bodies=off;`);
    await createZeroDirectSchemaBase(db);
    let previous = [];
    for (let n = 0; n <= 17; n += 1) {
      await applyZeroDirectSchemaMember(db, n);
      for (const d of previous) if (d.name !== "grainline_seller_deauthorization_application_immutable")
        await db.exec(`DROP FUNCTION ${d.identity}`);
      for (const d of scope.manifest.states[n]) {
        // Catalog-only fixture: referenced app tables are intentionally absent.
        // Native CI separately inspects the fully migrated real function tree.
        if (d.name !== "grainline_seller_deauthorization_application_immutable") await db.exec(d.definition);
        await db.exec(`REVOKE ALL ON FUNCTION ${d.identity} FROM PUBLIC`);
        if (d.runtimeExecute) await db.exec(`GRANT EXECUTE ON FUNCTION ${d.identity} TO grainline_app_runtime`);
      }
      previous = scope.manifest.states[n];
      const owner = { query: async (sql, args) => {
        if (sql === CORRECTION_RELEASE_LEDGER_QUERY) return { rows: ledger(n) };
        const r = await db.query(sql, args);
        if (sql.includes("current_database() AS database")) {
          assert.equal(r.rows[0].actor, "ci"); assert.equal(r.rows[0].login, "ci");
          // PGlite has one fixed database. Only its database name is modeled.
          r.rows[0].database = "grainline_ci";
        }
        return r;
      } };
      try { const s = await scope.readSnapshot(owner, "restart", "disposable"); assert.equal(scope.plan(s, "disposable").prefixLength, n); }
      catch (error) { error.message = `offline state ${n}: ${error.message}`; throw error; }
      assert.equal((await db.query("SHOW transaction_read_only")).rows[0].transaction_read_only, "off");
      if (n === 17) {
        const privateFunction = scope.manifest.states[n].find(d => !d.runtimeExecute).identity;
        for (const [change, undo] of [
          ['GRANT SELECT ON public."Order" TO PUBLIC', 'REVOKE SELECT ON public."Order" FROM PUBLIC'],
          ['GRANT SELECT(id) ON public."Order" TO PUBLIC', 'REVOKE SELECT(id) ON public."Order" FROM PUBLIC'],
          ['GRANT TRUNCATE ON public."Order" TO grainline_app_runtime', 'REVOKE TRUNCATE ON public."Order" FROM grainline_app_runtime'],
          [`GRANT EXECUTE ON FUNCTION ${privateFunction} TO grainline_app_runtime`, `REVOKE EXECUTE ON FUNCTION ${privateFunction} FROM grainline_app_runtime`],
          [`GRANT EXECUTE ON FUNCTION ${privateFunction} TO grainline_staff_read_runtime`, `REVOKE EXECUTE ON FUNCTION ${privateFunction} FROM grainline_staff_read_runtime`],
          ['CREATE POLICY unexpected ON public."Order" USING(true)', 'DROP POLICY unexpected ON public."Order"'],
          ['ALTER TABLE public."Order" ENABLE ROW LEVEL SECURITY', 'ALTER TABLE public."Order" DISABLE ROW LEVEL SECURITY'],
        ]) {
          await db.exec(change);
          try { await assert.rejects(scope.readSnapshot(owner, "restart", "disposable")); }
          finally { await db.exec(undo); }
          await scope.readSnapshot(owner, "after", "disposable");
        }
      }
    }
  } finally { await db.close(); }
});
