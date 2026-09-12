// Native failure fixtures only. No CLI, production URLs, ledger repair, DROP
// DATABASE, identity translation or production execution authorization.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { parseInputDraftProofConfig } from "./order-input-correction-drafts-postgres-proof.mjs";
import { verifyInputRuntimeIdentity } from "./order-input-correction-runtime-postgres-proof.mjs";
import { CORRECTION_RELEASE_LEDGER_QUERY } from "./order-correction-release-package.mjs";
import { runDisposableOrderExecution } from "./order-zero-direct-execution-disposable.mjs";

const BASELINE = "grainline_order_executor_baseline";
const FAILED = "grainline_order_executor_failed";
const NATIVE_FAILED = "grainline_order_executor_interrupted";
const MEMBER = "20260905100000_prepare_order_ban_review_authority";
const APP = "order-bounded-executor-disposable";
const hash = value => createHash("sha256").update(value).digest("hex");

// Installed only by the explicitly modified, hash-pinned failure-fixture
// checkout AFTER initial native scope and durable intent. Migration bytes stay
// unchanged. ddl_command_end runs before commit, so interruption may roll the
// DDL back; the proof reports the observed outcome rather than assuming residue.
export const ORDER_EXECUTOR_PAUSE_MEMBER_TEN_SQL = `
CREATE SCHEMA grainline_order_executor_failure_fixture;
REVOKE ALL ON SCHEMA grainline_order_executor_failure_fixture FROM PUBLIC;
CREATE FUNCTION grainline_order_executor_failure_fixture.pause_member_ten()
RETURNS event_trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $pause$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_event_trigger_ddl_commands()
    WHERE command_tag='CREATE TABLE' AND object_identity='public."OrderStaffCapability"') THEN
    PERFORM pg_catalog.pg_sleep(120);
  END IF;
END
$pause$;
REVOKE ALL ON FUNCTION grainline_order_executor_failure_fixture.pause_member_ten() FROM PUBLIC;
CREATE EVENT TRIGGER grainline_order_executor_pause ON ddl_command_end
WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION grainline_order_executor_failure_fixture.pause_member_ten();
`;

export function recoveryProofUrl(databaseUrl, database = "grainline_ci") {
  parseInputDraftProofConfig({ ORDER_INPUT_CORRECTION_DRAFTS_PROOF_DATABASE_URL: databaseUrl });
  const url = new URL(databaseUrl); assert.equal(url.hostname, "127.0.0.1");
  assert.ok(["grainline_ci", "postgres"].includes(database)); url.pathname = `/${database}`;
  return url.toString();
}

function privateRecord(directory, name, value) {
  assert.equal(fs.realpathSync(directory), directory);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  const fd = fs.openSync(path.join(directory, name), "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value) + "\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

async function connect(databaseUrl, githubActions, database = "grainline_ci") {
  const client = new pg.Client({ connectionString: recoveryProofUrl(databaseUrl, database), connectionTimeoutMillis: 10000,
    statement_timeout: 30000, query_timeout: 35000, application_name: "order-executor-recovery-monitor" });
  client.on("error", () => {});
  try {
    await client.connect(); await verifyInputRuntimeIdentity(client, database, "ci", githubActions);
    assert.deepEqual((await client.query("SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=CURRENT_USER")).rows, [{ rolsuper: true }]);
    return client;
  } catch { await client.end(); throw new Error("native recovery fixture identity rejected"); }
}

export function firstMemberTenStatement(manifest) {
  assert.equal(manifest.members[9].migration_name, MEMBER);
  const sql = fs.readFileSync(`prisma/migrations/${MEMBER}/migration.sql`, "utf8");
  assert.equal(hash(sql), manifest.members[9].checksum);
  const start = sql.indexOf('CREATE TABLE public."OrderStaffCapability" ('), end = sql.indexOf("\n);\n", start);
  assert.ok(start >= 0 && end > start);
  return sql.slice(start, end + 4);
}

export async function createOrderRecoveryFixture({ databaseUrl, githubActions, parent, manifest }) {
  const controller = await connect(databaseUrl, githubActions, "postgres");
  let original, baseline, nativeSnapshot, savedLedger, interrupted = false, failureInspected = false, rotated = false;
  const databases = async () => (await controller.query(`SELECT oid,datname,pg_catalog.pg_get_userbyid(datdba) AS owner,
    datistemplate,datallowconn FROM pg_catalog.pg_database WHERE datname=ANY($1::text[]) ORDER BY datname`,
  [["grainline_ci", BASELINE, FAILED, NATIVE_FAILED]])).rows;
  const quiet = async () => assert.deepEqual((await controller.query(
    "SELECT pid FROM pg_catalog.pg_stat_activity WHERE datname=ANY($1::text[])", [["grainline_ci", BASELINE, FAILED, NATIVE_FAILED]])).rows, []);
  const sameDatabase = (row, oid, name) => assert.deepEqual(row, { oid, datname: name, owner: "ci", datistemplate: false, datallowconn: true });
  async function ledger() {
    const owner = await connect(databaseUrl, githubActions);
    try { return (await owner.query(CORRECTION_RELEASE_LEDGER_QUERY)).rows; } finally { await owner.end(); }
  }
  try {
    const rows = await databases(); assert.equal(rows.length, 1); original = rows[0].oid; sameDatabase(rows[0], original, "grainline_ci");
    savedLedger = await ledger(); assert.equal(savedLedger.length, 234);
    for (const row of manifest.base) assert.ok(savedLedger.some(r => r.migration_name === row.migration_name
      && r.checksum === row.checksum && r.finished_at !== null && r.rolled_back_at === null && r.applied_steps_count === 1));
    await quiet();
    privateRecord(parent, "recovery-baseline-intent.json", { original, baselineName: BASELINE, failedName: FAILED, productionChanged: false });
    await controller.query(`CREATE DATABASE ${BASELINE} WITH TEMPLATE grainline_ci OWNER ci`);
    const created = await databases(); assert.equal(created.length, 2);
    sameDatabase(created.find(r => r.datname === "grainline_ci"), original, "grainline_ci");
    baseline = created.find(r => r.datname === BASELINE).oid; assert.notEqual(baseline, original);
    sameDatabase(created.find(r => r.datname === BASELINE), baseline, BASELINE);
    privateRecord(parent, "recovery-baseline-created.json", { original, baseline, ledgerSha256: hash(JSON.stringify(savedLedger)), productionChanged: false });
  } catch { await controller.end(); throw new Error("native recovery snapshot refused; preserve fixture"); }

  return Object.freeze({
    async interrupt(execute, closeWorker) {
      assert.ok(!interrupted && !rotated);
      let settled = false;
      const outcome = execute().then(value => { settled = true; return { value }; }, () => { settled = true; return { rejected: true }; });
      try {
        let observed;
        for (let attempt = 0; attempt < 300; attempt++) {
          const rows = (await controller.query(`SELECT pid,backend_start::text AS started,backend_xid::text AS xid,
            pg_catalog.md5(query) AS query_hash FROM pg_catalog.pg_stat_activity
            WHERE datname='grainline_ci' AND usename='ci' AND backend_type='client backend'
              AND state='active' AND wait_event='PgSleep' AND query LIKE '%CREATE TABLE public."OrderStaffCapability"%'`)).rows;
          assert.ok(rows.length <= 1);
          if (rows.length) { observed = rows[0]; break; }
          assert.equal(settled, false, "worker ended before native member-ten pause"); await delay(200);
        }
        assert.ok(observed && observed.xid, "native member-ten pause was not observed");
        privateRecord(parent, "recovery-inflight-observed.json", { ...observed, member: MEMBER, productionChanged: false });
        // Rebind PID, backend start and exact query immediately before signaling.
        assert.deepEqual((await controller.query(`SELECT pg_catalog.pg_terminate_backend(pid) AS terminated
          FROM pg_catalog.pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz
            AND datname='grainline_ci' AND usename='ci' AND state='active' AND wait_event='PgSleep'
            AND pg_catalog.md5(query)=$3`, [observed.pid, observed.started, observed.query_hash])).rows, [{ terminated: true }]);
        privateRecord(parent, "recovery-backend-interrupted.json", { ...observed, member: MEMBER, productionChanged: false });
        const result = await outcome; assert.equal(result.rejected, true); interrupted = true;
      } finally { await closeWorker(); }
    },
    async inspectFailure() {
      assert.ok(interrupted && !failureInspected && !rotated);
      const rows = await ledger(), failed = rows.filter(r => r.finished_at === null);
      assert.equal(rows.length, 244); assert.equal(failed.length, 1);
      assert.equal(failed[0].migration_name, MEMBER); assert.equal(failed[0].checksum, manifest.members[9].checksum);
      assert.equal(failed[0].rolled_back_at, null); assert.equal(failed[0].applied_steps_count, 0);
      for (const expected of [...manifest.base, ...manifest.members.slice(0, 9)]) assert.ok(rows.some(r => r.migration_name === expected.migration_name
        && r.checksum === expected.checksum && r.finished_at !== null && r.rolled_back_at === null && r.applied_steps_count === 1));
      const before = hash(JSON.stringify(rows));
      await quiet();
      // Preserve the exact native failure before introducing any additional
      // partial-DDL fixture. Neither failure database is dropped or repaired.
      assert.equal((await databases()).length, 2);
      await controller.query(`CREATE DATABASE ${NATIVE_FAILED} WITH TEMPLATE grainline_ci OWNER ci`);
      const snapshots = await databases(); assert.equal(snapshots.length, 3);
      nativeSnapshot = snapshots.find(r => r.datname === NATIVE_FAILED).oid;
      assert.ok(nativeSnapshot !== original && nativeSnapshot !== baseline);
      sameDatabase(snapshots.find(r => r.datname === NATIVE_FAILED), nativeSnapshot, NATIVE_FAILED);
      privateRecord(parent, "recovery-native-failure-snapshot.json", { nativeSnapshot, ledgerSha256: before, productionChanged: false });
      const owner = await connect(databaseUrl, githubActions);
      let nativePartialDdlRemained;
      try {
        nativePartialDdlRemained = (await owner.query(`SELECT to_regclass('public."OrderStaffCapability"') IS NOT NULL AS present`)).rows[0].present;
        // Preserve the native ledger verbatim. If PostgreSQL rolled DDL back,
        // add one explicitly modeled committed statement to exercise refusal
        // with BOTH an incomplete ledger and actual partial catalog residue.
        await owner.query("DROP EVENT TRIGGER grainline_order_executor_pause");
        if (!nativePartialDdlRemained) await owner.query(firstMemberTenStatement(manifest));
        assert.equal((await owner.query(`SELECT to_regclass('public."OrderStaffCapability"') IS NOT NULL AS present`)).rows[0].present, true);
      } finally { await owner.end(); }
      assert.equal(hash(JSON.stringify(await ledger())), before, "failure fixture rewrote the native ledger");
      failureInspected = true;
      const result = { incompleteMember: 10, nativePartialDdlRemained, partialDdlFixtureModeled: !nativePartialDdlRemained,
        nativeLedgerUnchanged: true, failedLedgerSha256: before, productionChanged: false };
      privateRecord(parent, "recovery-incomplete-state.json", result); return result;
    },
    async restoreBaseline() {
      assert.ok(interrupted && failureInspected && !rotated); await quiet();
      const rows = await databases(); assert.equal(rows.length, 3);
      sameDatabase(rows.find(r => r.datname === "grainline_ci"), original, "grainline_ci");
      sameDatabase(rows.find(r => r.datname === BASELINE), baseline, BASELINE);
      sameDatabase(rows.find(r => r.datname === NATIVE_FAILED), nativeSnapshot, NATIVE_FAILED);
      privateRecord(parent, "recovery-rotation-intent.json", { original, baseline, productionChanged: false });
      await controller.query("BEGIN");
      try {
        await controller.query(`ALTER DATABASE grainline_ci RENAME TO ${FAILED}`);
        await controller.query(`ALTER DATABASE ${BASELINE} RENAME TO grainline_ci`);
        await controller.query("COMMIT");
      } catch { await controller.query("ROLLBACK"); throw new Error("fixture rotation failed; preserve both databases"); }
      const after = await databases(); assert.equal(after.length, 3);
      sameDatabase(after.find(r => r.datname === FAILED), original, FAILED);
      sameDatabase(after.find(r => r.datname === "grainline_ci"), baseline, "grainline_ci");
      sameDatabase(after.find(r => r.datname === NATIVE_FAILED), nativeSnapshot, NATIVE_FAILED);
      assert.deepEqual(await ledger(), savedLedger); rotated = true;
      privateRecord(parent, "recovery-baseline-restored.json", { original, baseline, failedDatabasePreserved: true, productionChanged: false });
    },
    close: () => controller.end(),
  });
}

export async function proveOrderGrantGuardLoss(options) {
  const monitor = await connect(options.databaseUrl, options.githubActions, "postgres");
  let xid;
  try {
    await assert.rejects(runDisposableOrderExecution({ ...options, guard: async () => {
      await options.guard();
      const rows = (await monitor.query(`SELECT backend_xid::text AS xid FROM pg_catalog.pg_stat_activity
        WHERE datname='grainline_ci' AND usename='ci' AND application_name=$1
          AND state='idle in transaction' AND query LIKE 'REVOKE ALL ON FUNCTION public.grainline_%'`, [APP])).rows;
      assert.ok(rows.length <= 1);
      if (rows.length) { xid = rows[0].xid; assert.match(xid, /^[0-9]+$/u); throw new Error("fixture admission lost during grants"); }
    } }), error => error.executionPhase === "grant-convergence");
    assert.ok(xid);
    assert.deepEqual((await monitor.query("SELECT pg_catalog.pg_xact_status($1::xid8) AS status", [xid])).rows, [{ status: "aborted" }]);
    const journals = fs.readdirSync(options.parent).filter(name => name.startsWith("execution-journal-")); assert.equal(journals.length, 1);
    const directory = path.join(options.parent, journals[0]), saved = JSON.parse(fs.readFileSync(path.join(directory, "execution.json")));
    assert.equal(saved.stage, "grant-intent"); assert.equal(saved.initialPrefix, 17);
    assert.equal(fs.statSync(path.join(directory, "execution.lock")).mode & 0o777, 0o600);
    privateRecord(options.parent, "recovery-grant-aborted.json", { xid, nativeTransactionAborted: true, productionChanged: false });
    return { nativeGrantTransactionAborted: true, mutationPhaseGuardLossModeled: true, productionChanged: false };
  } finally { await monitor.end(); }
}
