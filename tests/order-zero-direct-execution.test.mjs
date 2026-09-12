import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { executeOrderZeroDirectPrefix, orderPrefixGrantSql } from "../scripts/order-zero-direct-execution.mjs";
import { disposablePrefixHistory, runDisposableOrderExecution } from "../scripts/order-zero-direct-execution-disposable.mjs";
import { createOrderZeroDirectReleaseScope } from "../scripts/order-zero-direct-release-scope.mjs";
import { createOrderZeroDirectFileFence } from "../scripts/order-zero-direct-release-files.mjs";
import { correctionProofAppliedRow } from "../scripts/order-correction-release-package-postgres-proof.mjs";

const actualScope = createOrderZeroDirectReleaseScope(), manifest = actualScope.manifest;
const rawHistory = n => [...manifest.base, ...manifest.members.slice(0, n)].map(r => correctionProofAppliedRow(r.migration_name, r.checksum));
function removeOwned(directory) {
  fs.chmodSync(directory, 0o700);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) removeOwned(path.join(directory, entry.name));
  fs.rmSync(directory, { recursive: true, force: true });
}
// Orchestration fixture: real catalog and staged bytes, controlled fresh scope
// observations and command failures. Native CI exercises actual PostgreSQL reads.
function fixture(t, initialPrefix = 0, fault = "") {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-execute-test-")); fs.chmodSync(parent, 0o700);
  t.after(() => removeOwned(parent));
  const journalDirectory = path.join(parent, "journal"); fs.mkdirSync(journalDirectory, { mode: 0o700 });
  const files = createOrderZeroDirectFileFence(), artifact = files.stage(disposablePrefixHistory(rawHistory(initialPrefix), manifest), parent);
  const events = []; let prefix = initialPrefix, lost = false, readCount = 0;
  const scope = { manifest, assertAuditedSnapshot: (snapshot, stage) => {
    if (stage === "after") assert.equal(snapshot.prefixLength, 17);
    return snapshot;
  } };
  const options = { sourceRoot: fs.realpathSync(process.cwd()), scope, files, artifact, parent, journalDirectory,
    binding: { releaseCommit: "a".repeat(40), sourceCatalogSha256: "b".repeat(64) }, mode: "disposable",
    guard: async () => { assert.equal(lost, false); },
    readAudited: async () => { events.push("read"); readCount++; if (fault === "stale" && readCount === 1) return { prefixLength: 1 };
      if (fault === "final-audit" && readCount === 5) throw new Error("audit drift"); return { prefixLength: prefix }; },
    connect: async () => ({ query: async sql => {
      events.push(sql.startsWith("REVOKE") ? "grants" : sql);
      if (sql.startsWith("REVOKE") && fault === "lost-grant") lost = true;
    }, end: async () => events.push("end") }),
    prisma: async (args, checkpoint) => {
      const saved = JSON.parse(fs.readFileSync(path.join(journalDirectory, "execution.json")));
      assert.equal(saved.stage, args[1] === "deploy" ? "apply-intent" : "grants-verified");
      const config = await import(`file://${args[3]}`); assert.equal(config.default.migrations.path, artifact.directory);
      assert.equal(fs.readdirSync(artifact.directory).length, 252);
      assert.ok(!fs.existsSync(path.join(artifact.directory, "20260906010000_correct_order_participant_list_projection")));
      await checkpoint(); events.push(args[1]);
      if (fault === "lost-apply") { lost = true; await checkpoint(); }
      if (fault === args[1]) throw new Error("ambiguous command result");
      if (args[1] === "deploy") prefix = fault === "partial" ? 10 : 17;
    },
  };
  return { options, events, saved: () => JSON.parse(fs.readFileSync(path.join(journalDirectory, "execution.json"))) };
}
test("all 18 disposable histories retain the real prefix and reject incomplete or foreign rows", () => {
  for (let n = 0; n <= 17; n++) assert.equal(actualScope.classify(disposablePrefixHistory(rawHistory(n), manifest), "restart").prefixLength, n);
  for (const mutate of [rows => { rows[243].finished_at = null; }, rows => { rows[243].checksum = "0".repeat(64); },
    rows => { rows[243].applied_steps_count = 0; }, rows => { rows[243].migration_name = "unknown"; }, rows => rows.push(rows[0])]) {
    const rows = rawHistory(10); mutate(rows); assert.throws(() => disposablePrefixHistory(rows, manifest));
  }
});
test("prefix application and complete-prefix entry both converge, status-check and audit", async t => {
  for (const prefix of [0, 10, 17]) {
    const f = fixture(t, prefix), result = await executeOrderZeroDirectPrefix(f.options);
    assert.equal(result.appliedMemberCount, 17 - prefix); assert.equal(result.productionExecutionAuthorized, false);
    assert.equal(f.saved().stage, "complete");
    assert.deepEqual(f.events, ["read", ...(prefix < 17 ? ["deploy"] : []), "read", "BEGIN", "SET LOCAL lock_timeout = '5s'",
      "SET LOCAL statement_timeout = '30s'", "grants", "COMMIT", "end", "read", "status", "read", "read"]);
    assert.equal(fs.existsSync(path.join(f.options.journalDirectory, "execution.lock")), false);
  }
});
test("ambiguous application, partial result, lost claim and later failures preserve intent without replay", async t => {
  for (const [fault, stage] of [["deploy", "apply-intent"], ["partial", "apply-intent"], ["lost-apply", "apply-intent"], ["lost-grant", "grant-intent"],
    ["status", "grants-verified"], ["final-audit", "audit-verified"]]) {
    const f = fixture(t, 0, fault); await assert.rejects(executeOrderZeroDirectPrefix(f.options), /preserve journal/u);
    assert.equal(f.saved().stage, stage); assert.ok(fs.existsSync(path.join(f.options.journalDirectory, "execution.lock")));
    assert.equal(f.events.filter(e => e === "deploy").length, 1);
    if (fault === "lost-grant") { assert.ok(f.events.includes("ROLLBACK")); assert.ok(!f.events.includes("COMMIT")); }
    if (["deploy", "partial"].includes(fault)) assert.ok(!f.events.includes("grants"));
  }
});
test("fresh-prefix disagreement and artifact drift stop before migration intent", async t => {
  for (const fault of ["stale", "artifact"]) {
    const f = fixture(t, 0, fault);
    if (fault === "artifact") {
      const file = path.join(f.options.artifact.directory, "migration_lock.toml"); fs.chmodSync(file, 0o600); fs.appendFileSync(file, "# drift\n");
    }
    await assert.rejects(executeOrderZeroDirectPrefix(f.options)); assert.ok(!f.events.includes("deploy"));
    assert.equal(fs.existsSync(path.join(f.options.journalDirectory, "execution.json")), false);
  }
});
test("disposable writer rejects production, alternate hosts and roles before any guard or connection", async () => {
  for (const databaseUrl of ["postgresql://ci:ci@example.com/grainline_ci", "postgresql://ci:ci@localhost/grainline_ci",
    "postgresql://owner:password@127.0.0.1/neondb", "postgresql://ci:ci@127.0.0.1:5433/grainline_ci"]) {
    let called = false; await assert.rejects(runDisposableOrderExecution({ databaseUrl, guard: () => { called = true; } })); assert.equal(called, false);
  }
});
test("real SQL convergence grants exactly the reviewed runtime partition and preserves unrelated authority", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE ROLE grainline_app_runtime; CREATE ROLE grainline_staff_read_runtime; CREATE FUNCTION public.unrelated() RETURNS integer LANGUAGE sql AS 'SELECT 1';");
    for (const def of manifest.states[17]) await db.exec(`CREATE FUNCTION ${def.identity} RETURNS integer LANGUAGE sql AS 'SELECT 1'; GRANT EXECUTE ON FUNCTION ${def.identity} TO grainline_app_runtime;`);
    await db.exec(orderPrefixGrantSql(manifest));
    for (const def of manifest.states[17]) {
      const result = await db.query("SELECT has_function_privilege('grainline_app_runtime',$1,'EXECUTE') AS runtime, has_function_privilege('grainline_staff_read_runtime',$1,'EXECUTE') AS staff", [def.identity]);
      assert.deepEqual(result.rows[0], { runtime: def.runtimeExecute, staff: false });
    }
    assert.equal((await db.query("SELECT has_function_privilege('grainline_app_runtime','public.unrelated()','EXECUTE') AS allowed")).rows[0].allowed, true);
  } finally { await db.close(); }
});
