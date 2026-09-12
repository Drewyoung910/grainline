import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { createOrderZeroDirectReleaseScope } from "../scripts/order-zero-direct-release-scope.mjs";
import { CORRECTION_RELEASE_LEDGER_QUERY } from "../scripts/order-correction-release-package.mjs";
import { correctionProofAppliedRow } from "../scripts/order-correction-release-package-postgres-proof.mjs";
import { ORDER_EXECUTOR_PAUSE_MEMBER_TEN_SQL, createOrderRecoveryFixture, firstMemberTenStatement,
  recoveryProofUrl } from "../scripts/order-zero-direct-execution-recovery-postgres-proof.mjs";

const databaseUrl = "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";
const manifest = createOrderZeroDirectReleaseScope().manifest;
const originalPgClient = pg.Client;
const applied = rows => rows.map(r => correctionProofAppliedRow(r.migration_name, r.checksum));

// Controller protocol fixture only; native CI proves actual transactions,
// backend interruption and independent fresh-worker refusal.
function fixture(t, options = {}) {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-recovery-test-")); fs.chmodSync(parent, 0o700);
  const baseline = applied(manifest.base), events = [], state = { rows: structuredClone(baseline), partial: false,
    databases: [{ oid: 1, datname: "grainline_ci", owner: "ci", datistemplate: false, datallowconn: true }], ...options };
  let failExecution, priorDatabases;
  const prior = originalPgClient;
  pg.Client = class {
    constructor(config) { this.database = new URL(config.connectionString).pathname.slice(1); }
    on() {} async connect() {} async end() {}
    async query(sql) {
      const result = rows => ({ rows: structuredClone(rows), rowCount: rows.length });
      if (sql.includes("current_database() AS db")) return result([{ db: this.database, actor: "ci", login: "ci", version: 160000, host: "127.0.0.1" }]);
      if (sql.startsWith("SELECT rolsuper")) return result([{ rolsuper: true }]);
      if (sql.includes("datistemplate,datallowconn")) return result(state.databases.toSorted((a,b) => a.datname.localeCompare(b.datname)));
      if (sql === CORRECTION_RELEASE_LEDGER_QUERY) return result(state.rows);
      if (sql.startsWith("SELECT pid FROM")) return result(state.active ? [{ pid: 999 }] : []);
      if (sql.startsWith("SELECT pid,backend_start")) return result([{ pid: 321, started: "2026-09-12T00:00:00Z", xid: "123", query_hash: "a".repeat(32) }]);
      if (sql.startsWith("SELECT pg_catalog.pg_terminate_backend")) {
        if (state.reboundBackend) return result([]);
        events.push("terminate"); state.rows = applied([...manifest.base, ...manifest.members.slice(0,10)]);
        Object.assign(state.rows.at(-1), { finished_at: null, applied_steps_count: 0 });
        failExecution(new Error("native connection lost fixture")); return result([{ terminated: true }]);
      }
      if (sql.startsWith("SELECT to_regclass")) return result([{ present: state.partial }]);
      events.push(sql);
      if (sql.startsWith("CREATE DATABASE")) state.databases.push({ oid: sql.includes("interrupted") ? 3 : 2,
        datname: sql.includes("interrupted") ? "grainline_order_executor_interrupted" : "grainline_order_executor_baseline", owner: "ci", datistemplate: false, datallowconn: true });
      else if (sql.startsWith('CREATE TABLE public."OrderStaffCapability"')) state.partial = true;
      else if (sql === "BEGIN") priorDatabases = structuredClone(state.databases);
      else if (sql === "ROLLBACK") state.databases = priorDatabases;
      else if (sql.startsWith("ALTER DATABASE")) {
        if (state.failSecondRename && sql.includes("baseline RENAME")) throw new Error("injected rename failure");
        const [, from, to] = sql.match(/^ALTER DATABASE (\w+) RENAME TO (\w+)$/u);
        state.databases.find(row => row.datname === from).datname = to;
        if (to === "grainline_ci") state.rows = structuredClone(baseline);
      }
      return result([]);
    }
  };
  t.after(() => { pg.Client = prior; fs.rmSync(parent, { recursive: true, force: true }); });
  return { parent, state, events, start: () => createOrderRecoveryFixture({ databaseUrl, githubActions: false, parent, manifest }),
    execute: () => new Promise((_, reject) => { failExecution = reject; }),
    closeWorker: async () => { events.push("worker-closed"); failExecution?.(new Error("fixture worker closed")); } };
}

test("recovery controller has only the fixed numeric-loopback CI and postgres targets", () => {
  assert.equal(new URL(recoveryProofUrl(databaseUrl, "postgres")).pathname, "/postgres");
  for (const url of ["postgresql://ci:ci@localhost:5432/grainline_ci", "postgresql://ci:ci@external.invalid/grainline_ci",
    "postgresql://neondb_owner:secret@127.0.0.1/neondb", databaseUrl + "&options=-crole=owner"]) assert.throws(() => recoveryProofUrl(url));
  for (const database of ["neondb", "arbitrary", "grainline_order_executor_failed"]) assert.throws(() => recoveryProofUrl(databaseUrl, database));
});

test("fixture pause targets member-ten DDL and does not assume its transaction commits", async () => {
  const db = new PGlite();
  try {
    // Local SQL validation replaces only the wait with an observable failure;
    // native CI runs the original wait and terminates the actual backend.
    await db.exec(ORDER_EXECUTOR_PAUSE_MEMBER_TEN_SQL.replace("PERFORM pg_catalog.pg_sleep(120);", "RAISE EXCEPTION 'member-ten-pause-reached';"));
    await db.exec("CREATE TABLE public.unrelated_fixture(id integer);");
    await assert.rejects(db.exec(firstMemberTenStatement(manifest)), /member-ten-pause-reached/u);
    assert.equal((await db.query(`SELECT to_regclass('public."OrderStaffCapability"') IS NULL AS absent`)).rows[0].absent, true);
    await db.exec("DROP EVENT TRIGGER grainline_order_executor_pause"); await db.exec(firstMemberTenStatement(manifest));
    const rows = (await db.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public."OrderStaffCapability"'::regclass`)).rows;
    assert.deepEqual(rows, [{ relrowsecurity: false, relforcerowsecurity: false }]);
  } finally { await db.close(); }
});

test("pre-existing databases and active sessions stop before snapshot creation", async t => {
  for (const options of [{ active: true }, { databases: [{ oid: 9, datname: "foreign", owner: "foreign" }] },
    { databases: [{ oid: 1, datname: "grainline_ci", owner: "ci", datistemplate: false, datallowconn: true }, { oid: 2, datname: "grainline_order_executor_baseline" }] }]) {
    const f = fixture(t, options); await assert.rejects(f.start());
    assert.ok(!f.events.some(sql => sql.startsWith("CREATE DATABASE")));
  }
});

test("failure preserves its ledger and database while a verified template is rotated back", async t => {
  const f = fixture(t), recovery = await f.start();
  await recovery.interrupt(f.execute, f.closeWorker);
  const failedRows = structuredClone(f.state.rows), result = await recovery.inspectFailure();
  assert.equal(result.nativePartialDdlRemained, false); assert.equal(result.partialDdlFixtureModeled, true);
  assert.deepEqual(f.state.rows, failedRows); assert.equal(f.state.partial, true);
  await recovery.restoreBaseline(); await recovery.close();
  assert.equal(f.state.databases.find(r => r.oid === 1).datname, "grainline_order_executor_failed");
  assert.equal(f.state.databases.find(r => r.oid === 2).datname, "grainline_ci");
  assert.equal(f.state.databases.find(r => r.oid === 3).datname, "grainline_order_executor_interrupted");
  assert.equal(f.state.rows.length, 234);
  assert.ok(!f.events.some(sql => /DROP DATABASE|UPDATE .*_prisma_migrations|DELETE .*_prisma_migrations/u.test(sql)));
  for (const name of fs.readdirSync(f.parent)) assert.equal(fs.statSync(path.join(f.parent,name)).mode & 0o777, 0o600);
  await assert.rejects(recovery.restoreBaseline());
});

test("changed snapshot identity and failed second rename cannot silently complete recovery", async t => {
  for (const fault of ["identity", "rename"]) {
    const f = fixture(t), recovery = await f.start();
    await recovery.interrupt(f.execute, f.closeWorker); await recovery.inspectFailure();
    if (fault === "identity") f.state.databases.find(r => r.oid === 2).oid = 99;
    else f.state.failSecondRename = true;
    await assert.rejects(recovery.restoreBaseline());
    assert.equal(fs.existsSync(path.join(f.parent, "recovery-baseline-restored.json")), false);
    assert.equal(f.state.databases.find(r => r.oid === 1).datname, "grainline_ci");
    if (fault === "rename") assert.ok(f.events.includes("ROLLBACK"));
    await recovery.close();
  }
});

test("a backend that changed since observation cannot be signaled or followed by fixture rotation", async t => {
  const f = fixture(t, { reboundBackend: true }), recovery = await f.start();
  await assert.rejects(recovery.interrupt(f.execute, f.closeWorker));
  assert.ok(f.events.includes("worker-closed")); assert.ok(!f.events.includes("terminate"));
  assert.equal(fs.existsSync(path.join(f.parent, "recovery-backend-interrupted.json")), false);
  await assert.rejects(recovery.inspectFailure()); await assert.rejects(recovery.restoreBaseline()); await recovery.close();
  assert.ok(!f.events.some(sql => sql.startsWith("ALTER DATABASE")));
});
