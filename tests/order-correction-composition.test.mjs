import assert from "node:assert/strict";
import { offlineCompositionFixture } from "./helpers/order-correction-offline-fixture.mjs";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { correctionCompositionBundle, correctionCompositionManifest } from "../scripts/order-correction-composition-manifest.mjs";
import { parseCompositionProofConfig, compositionTransactionAdapter, compositionRowFingerprint,
  proveCompositionTransaction } from "../scripts/order-correction-composition-postgres-proof.mjs";
import { repairProofCatalog } from "../scripts/checkout-repair-outcome-runtime-postgres-proof.mjs";
import { assertOnlyInputBodiesChanged } from "../scripts/order-input-correction-drafts-postgres-proof.mjs";

test("composition manifest preserves six fixed drafts, nine distinct bodies and separate release dependencies", () => {
  const manifest = correctionCompositionManifest();
  assert.equal(manifest.prefix.length, 17);
  assert.equal(manifest.productionExecutionAuthorized, false);
  assert.deepEqual(manifest.packages.map((p) => p.boundary), [
    "order-compatible", "order-compatible", "order-compatible", "order-compatible",
    "case-reader-first", "reservation-integrity-separate",
  ]);
  const functions = manifest.packages.flatMap((p) => p.functions);
  assert.equal(functions.length, 9);
  assert.equal(new Set(functions.map((f) => f.name)).size, 9);
  assert.deepEqual(functions.filter((f) => !f.runtimeExecute).map((f) => f.name), ["grainline_notification_create_core"]);
  assert.equal(manifest.releaseDependencies.length, 3);
  for (const entry of correctionCompositionBundle()) {
    assert.doesNotMatch(entry.payload, /^(?:BEGIN|COMMIT|ROLLBACK);$/mu);
    assert.doesNotMatch(entry.payload, /(?:GRANT|REVOKE|CREATE POLICY|ALTER TABLE) /u);
    for (const def of entry.definitions) assert.ok(entry.payload.includes(def.after));
  }
});

test("combined proof refuses non-CI targets and runs after all independent proofs, never from production workflows", () => {
  const valid = "postgresql://ci:ci@localhost:5432/grainline_ci?sslmode=disable";
  const parse = (url) => parseCompositionProofConfig({ ORDER_CORRECTION_COMPOSITION_PROOF_DATABASE_URL: url });
  assert.deepEqual(parse(valid), { databaseUrl: valid });
  for (const url of [undefined, valid.replace("localhost", "remote.example"), valid.replace("grainline_ci", "neondb"),
    valid.replace("//ci:", "//grainline_app_runtime:"), valid.replace("//ci:", "//neondb_owner:"),
    valid.replace("5432", "6543"), valid + "&host=remote", valid + "#override", valid.replace("postgresql:", "https:")]) {
    assert.throws(() => parse(url));
  }
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const step = "Prove exact Order Case reservation correction composition and rollback";
  assert.ok(workflow.indexOf(step) > workflow.indexOf("Prove reservation repair correction through an actual runtime login"));
  assert.match(workflow, /ORDER_CORRECTION_COMPOSITION_PROOF_DATABASE_URL: \$\{\{ env.DIRECT_URL \}\}/u);
  const source = readFileSync("scripts/order-correction-composition-postgres-proof.mjs", "utf8");
  assert.match(source, /actualRuntimeLoginProven: false/u);
  assert.match(source, /providerEffectsProved: false/u);
  assert.doesNotMatch(source, /ALTER ROLE|CREATE DATABASE|DROP DATABASE|readFileSync|process\.env\.(?:DATABASE_URL|DIRECT_URL)/u);
});

test("fixture adapter never commits its enclosing proof and restores nested rollback", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE marker(id integer PRIMARY KEY)");
    await db.exec("BEGIN");
    const adapter = compositionTransactionAdapter(db, "composition_adapter");
    await adapter.query("BEGIN");
    await adapter.query("INSERT INTO marker VALUES (1)");
    await assert.rejects(adapter.query("BEGIN"), /nested fixture/);
    await adapter.query("COMMIT");
    await assert.rejects(adapter.query("COMMIT"), /unbalanced fixture/);
    await adapter.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    await adapter.query("INSERT INTO marker VALUES (2)");
    await adapter.query("ROLLBACK");
    for (const sql of ["BEGIN;", "COMMIT;", "START TRANSACTION", "END", "ROLLBACK;"]) {
      await assert.rejects(adapter.query(sql), /unreviewed fixture transaction/);
    }
    assert.throws(() => compositionTransactionAdapter(db, "x; COMMIT"));
    assert.deepEqual((await db.query("SELECT id FROM marker")).rows, [{ id: 1 }]);
    await db.exec("ROLLBACK");
    assert.deepEqual((await db.query("SELECT id FROM marker")).rows, []);
  } finally { await db.close(); }
});


test("all nine real bodies compose on the offline schema, preserve scenarios and roll back failures", async () => {
  // Selected real functions/constraints over the Prisma schema, not a claim of
  // a fully migrated catalog or actual runtime authentication. Native CI supplies
  // the complete 17-member prefix, historical ledger and all live triggers.
  const db = await offlineCompositionFixture();
  try {
    const owner = { query: (sql, params) => params === undefined && sql.includes("\n")
      && sql.includes("DO $") ? db.exec(sql) : db.query(sql, params) };
    const before = await repairProofCatalog(owner);
    const rowState = await compositionRowFingerprint(owner);
    for (const failAt of [1, 4, 5, 6]) {
      let count = 0;
      const failing = { query: async (sql, params) => {
        const result = await owner.query(sql, params);
        if (sql.includes("SET LOCAL lock_timeout") && ++count === failAt) await db.query("SELECT 1/0");
        return result;
      } };
      await assert.rejects(proveCompositionTransaction(failing), { code: "22012" });
      assert.ok(JSON.stringify(await repairProofCatalog(owner)) === JSON.stringify(before));
    }
    let phase;
    let result;
    try { result = await proveCompositionTransaction(owner, (value) => { phase = value; }); }
    catch (error) { error.message = `${phase}: ${error.message}`; throw error; }
    assert.equal(result.correctedFunctions, 9);
    assert.equal(result.replayDenials, 6);
    assert.equal(result.caseScenarios, 17);
    assert.equal(result.input.denials, 25);
    assert.equal(result.repair.invalidInputs, 20);
    assert.equal(result.repair.legitimateOutcomes, 12);
    assert.equal(result.label.utcClock, true);
    assert.equal(result.actualRuntimeLoginProven, false);
    assert.deepEqual(await compositionRowFingerprint(owner), rowState);
    assert.ok(JSON.stringify(await repairProofCatalog(owner)) === JSON.stringify(before));
    const definitions = correctionCompositionBundle().flatMap((p) => p.definitions);
    const after = structuredClone(before);
    for (const def of definitions) after.functions.find((f) => f.proname === def.name).prosrc = def.after.split(def.tag)[1];
    assertOnlyInputBodiesChanged(before, after, definitions);
    for (const key of ["relations", "columns", "roles", "memberships", "policies", "migrations", "constraints", "triggers", "indexes", "namespaces", "defaults"]) {
      const drift = structuredClone(after); drift[key] = [{ unexpected: true }];
      assert.throws(() => assertOnlyInputBodiesChanged(before, drift, definitions), (error) => error.actual === false && error.expected === true);
    }
    const extra = structuredClone(after);
    extra.functions.find((f) => f.proname === "grainline_notification_create_core").proacl = ["=X/ci"];
    assert.throws(() => assertOnlyInputBodiesChanged(before, extra, definitions), (error) => error.actual === false);
  } finally { await db.close(); }
});
