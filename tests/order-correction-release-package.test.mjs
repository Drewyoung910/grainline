import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCorrectionReleasePackage, CORRECTION_RELEASE_BOUNDARIES, CORRECTION_RELEASE_MIGRATIONS } from "../scripts/order-correction-release-package.mjs";
import { correctionCompositionBundle } from "../scripts/order-correction-composition-manifest.mjs";
import { correctionProofAppliedRow, correctionProofHistoricalLedger, parseCorrectionReleaseProofConfig,
  proveCorrectionReleasePackage } from "../scripts/order-correction-release-package-postgres-proof.mjs";
import { offlineCompositionFixture } from "./helpers/order-correction-offline-fixture.mjs";

const release = createCorrectionReleasePackage();
const bundle = correctionCompositionBundle();
const plainLedger = release.manifest.predecessor.map((e) => correctionProofAppliedRow(e.migration_name, e.checksum));
const history = correctionProofHistoricalLedger(plainLedger, release.manifest);
function request(boundary = "order-compatible", stage = "restart", order = 0, cases = 0, repair = 0) {
  return { boundary, stage, companions: Object.fromEntries(Object.entries({
    "order-compatible": order, "case-reader-first": cases, "reservation-integrity-separate": repair,
  }).filter(([key]) => key !== boundary)) };
}
function snapshot(order = 0, cases = 0, repair = 0) {
  const counts = { "order-compatible": order, "case-reader-first": cases, "reservation-integrity-separate": repair };
  const seen = {}; const ledgerRows = structuredClone(history); const functionRows = [];
  for (const [index, pkg] of release.manifest.packages.entries()) {
    const i = seen[pkg.boundary] ?? 0; seen[pkg.boundary] = i + 1;
    const corrected = i < counts[pkg.boundary];
    if (corrected) ledgerRows.push(correctionProofAppliedRow(pkg.migration_name, pkg.checksum));
    for (const [j, def] of pkg.functions.entries()) {
      const bodyDef = bundle[index].definitions[j];
      functionRows.push({ name: def.name, identity_matches: true, owner_name: "neondb_owner",
        language: "plpgsql", kind: "f", security_definer: true, leakproof: false, strict: false,
        volatility: "v", parallel_safety: "u", configuration: ["search_path=pg_catalog"],
        return_type: def.returnType, returns_set: def.returnsSet, arg_names: def.argNames, arg_modes: def.argModes,
        argument_defaults: 0, variadic: false, runtime_execute: def.runtimeExecute, invalid_acl_count: 0,
        body: bodyDef[corrected ? "after" : "before"].split(bodyDef.tag)[1] });
    }
  }
  return { ledgerRows, functionRows };
}

test("source-only release pins every predecessor, six exact drafts and separate boundaries", () => {
  assert.equal(release.manifest.predecessor.length, 251);
  assert.equal(release.manifest.packages.length, 6);
  assert.equal(release.manifest.productionExecutionAuthorized, false);
  assert.equal(release.manifest.acceptedCompositionCi, "34203109385");
  assert.equal(Object.isFrozen(release.manifest.packages[0].functions[0].argNames), true);
  assert.deepEqual(release.manifest.packages.filter((p) => p.boundary === "order-compatible").map((p) => p.migration_name), CORRECTION_RELEASE_MIGRATIONS.slice(0, 4));
  assert.deepEqual(release.manifest.packages.flatMap((p) => p.functions).filter((f) => !f.runtimeExecute).map((f) => f.name), ["grainline_notification_create_core"]);
});

test("all 20 Order restart states bind companion releases explicitly and preserve remaining order", () => {
  for (let order = 0; order <= 4; order += 1) for (const cases of [0, 1]) for (const repair of [0, 1]) {
    const state = release.assertSnapshot(snapshot(order, cases, repair), request("order-compatible", "restart", order, cases, repair));
    assert.equal(state.appliedCounts["order-compatible"], order);
    assert.deepEqual(state.remainingMigrations, CORRECTION_RELEASE_MIGRATIONS.slice(order, 4));
    assert.equal(state.productionExecutionAuthorized, false);
    if (order === 0 || order === 4) release.assertSnapshot(snapshot(order, cases, repair), request("order-compatible", order === 0 ? "before" : "after", order, cases, repair));
  }
  for (const boundary of CORRECTION_RELEASE_BOUNDARIES.slice(1)) for (const order of [0, 4]) for (const cases of [0, 1]) for (const repair of [0, 1]) {
    release.assertSnapshot(snapshot(order, cases, repair), request(boundary, "restart", order, cases, repair));
  }
});

test("unknown, missing, duplicate, incomplete, rolled-back and drifted ledger rows fail closed", () => {
  for (const corrupt of [
    (s) => s.ledgerRows.pop(),
    (s) => s.ledgerRows.push(structuredClone(s.ledgerRows[0])),
    (s) => { s.ledgerRows[0].checksum = "0".repeat(64); },
    (s) => { s.ledgerRows[0].finished_at = null; },
    (s) => { s.ledgerRows[0].finished_at = "invalid"; },
    (s) => { s.ledgerRows[0].applied_steps_count = true; },
    (s) => s.ledgerRows.push(correctionProofAppliedRow("20990101000000_unknown", "0".repeat(64))),
    (s) => { s.ledgerRows.at(-1).rolled_back_at = new Date(); },
    (s) => { s.ledgerRows.at(-1).applied_steps_count = 0; },
    (s) => s.ledgerRows.splice(s.ledgerRows.findIndex((r) => r.migration_name === CORRECTION_RELEASE_MIGRATIONS[0]), 1),
  ]) {
    const s = snapshot(4); corrupt(s);
    assert.throws(() => release.assertSnapshot(s, request()));
  }
  assert.throws(() => release.assertSnapshot(snapshot(1), request("order-compatible", "before")));
  assert.throws(() => release.assertSnapshot(snapshot(3), request("order-compatible", "after")));
  assert.throws(() => release.assertSnapshot(snapshot(4, 1), request()));
  assert.throws(() => release.assertSnapshot(snapshot(2, 1), request("case-reader-first", "restart", 2, 1)));
  for (const r of [undefined, {}, { ...request(), stage: "apply" }, { ...request(), boundary: "all" },
    { ...request(), companions: {} }, { ...request(), bypass: true }]) assert.throws(() => release.assertSnapshot(snapshot(), r));
});

test("historical exceptions remain exact instead of admitting arbitrary failed ledger rows", () => {
  assert.equal(history.length, 253);
  assert.throws(() => release.classify(plainLedger, request()));
  for (const index of history.flatMap((r, i) => r.rolled_back_at ? [i] : [])) {
    for (const change of [
      (r) => { r.checksum = "0".repeat(64); }, (r) => { r.applied_steps_count = 1; },
      (r) => { r.finished_at = new Date(); }, (r) => { r.rolled_back_at = null; },
    ]) {
      const rows = structuredClone(history); change(rows[index]);
      assert.throws(() => release.classify(rows, request()));
    }
  }
});

test("migration records and all nine function bodies must agree at each boundary", () => {
  for (const corrected of [false, true]) {
    const s = corrected ? snapshot(4, 1, 1) : snapshot();
    const r = request("order-compatible", "restart", corrected ? 4 : 0, corrected ? 1 : 0, corrected ? 1 : 0);
    for (const [i, row] of s.functionRows.entries()) {
      const other = corrected ? snapshot() : snapshot(4, 1, 1);
      const drift = structuredClone(s); drift.functionRows[i].body = other.functionRows[i].body;
      assert.throws(() => release.assertSnapshot(drift, r), /body disagrees/);
      for (const [field, value] of Object.entries({ owner_name: "grainline_app_runtime", identity_matches: false,
        strict: true, kind: "p", leakproof: true, security_definer: false, language: "sql",
        parallel_safety: "s", volatility: "s", configuration: ["search_path=public"],
        return_type: "text", returns_set: !row.returns_set, argument_defaults: 1, variadic: true,
        arg_names: ["renamed_argument"], arg_modes: ["b"], runtime_execute: !row.runtime_execute, invalid_acl_count: 1 })) {
        if (row[field] === value) continue;
        const changed = structuredClone(s); changed.functionRows[i][field] = value;
        assert.throws(() => release.assertSnapshot(changed, r), /identity or authority/);
      }
    }
    const overloaded = structuredClone(s); overloaded.functionRows[0] = structuredClone(overloaded.functionRows[1]);
    assert.throws(() => release.assertSnapshot(overloaded, r));
  }
});

test("disposable proof refuses every non-CI target and production execution remains unwired", () => {
  const url = "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable";
  const parse = (value) => parseCorrectionReleaseProofConfig({ ORDER_CORRECTION_RELEASE_PACKAGE_PROOF_DATABASE_URL: value });
  assert.equal(parse(url).databaseUrl, url);
  for (const value of [undefined, url.replace("localhost", "neon.example"), url.replace("grainline_ci", "neondb"),
    url.replace("//ci:", "//neondb_owner:"), url + "&host=remote", url + "#override"]) assert.throws(() => parse(value));
  const source = readFileSync("scripts/order-correction-release-package.mjs", "utf8");
  assert.doesNotMatch(source, /new (?:pg\.)?Client|writeFile|execFile|ALTER ROLE|GRANT EXECUTE/u);
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.ok(workflow.indexOf("Prove correction release ledger and body restart states") > workflow.indexOf("Prove exact Order Case reservation correction composition and rollback"));
});

test("real catalog reader and all seven sequential states pass with explicit offline ledger modeling", async () => {
  const db = await offlineCompositionFixture();
  try {
    await db.exec(`ALTER TABLE public._prisma_migrations ADD COLUMN migration_name text,
      ADD COLUMN checksum text, ADD COLUMN finished_at timestamptz, ADD COLUMN rolled_back_at timestamptz,
      ADD COLUMN applied_steps_count integer, ADD COLUMN started_at timestamptz DEFAULT now()`);
    await db.query(`INSERT INTO public._prisma_migrations(id,migration_name,checksum,finished_at,rolled_back_at,applied_steps_count)
      SELECT migration_name,migration_name,checksum,finished_at,rolled_back_at,applied_steps_count
      FROM jsonb_to_recordset($1::jsonb) AS r(migration_name text,checksum text,finished_at timestamptz,rolled_back_at timestamptz,applied_steps_count integer)`, [JSON.stringify(plainLedger)]);
    const owner = { query: (sql, params) => params === undefined && sql.includes("\n") && sql.includes("DO $") ? db.exec(sql) : db.query(sql, params) };
    let phase;
    let result;
    try { result = await proveCorrectionReleasePackage(owner, (value) => { phase = value; }); }
    catch (error) { error.message = `${phase}: ${error.message}`; throw error; }
    assert.equal(result.checkedStates, 7);
    assert.equal(result.mismatchDenials, 12);
    assert.equal(result.migrationLedgerMutated, false);
    assert.equal(result.actualRuntimeLoginProven, false);
    assert.equal(result.productionChanged, false);
    const assertActual = async () => release.assertSnapshot({ ledgerRows: history,
      functionRows: (await release.readTargets(owner)).map((row) => ({ ...row, owner_name: "neondb_owner" })) }, request());
    await assertActual();
    for (const ddl of [
      `GRANT EXECUTE ON FUNCTION public.grainline_notification_create_core(text,text,public."NotificationType",text,text,text) TO PUBLIC`,
      `ALTER FUNCTION public.grainline_case_open(text,text,text,text) STRICT`,
      `CREATE FUNCTION public.grainline_case_open() RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb'`,
      `ALTER FUNCTION public.grainline_case_escalate(text,text) SET search_path TO public`,
    ]) {
      await db.exec("BEGIN");
      try { await db.exec(ddl); await assert.rejects(assertActual()); }
      finally { await db.exec("ROLLBACK"); }
      await assertActual();
    }
  } finally { await db.close(); }
});
