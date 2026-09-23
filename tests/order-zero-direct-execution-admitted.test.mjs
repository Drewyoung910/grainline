import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createOrderAdmittedExecutor } from "../scripts/order-zero-direct-execution-admitted.mjs";
import { createOrderExecutionWatch } from "../scripts/order-zero-direct-execution-watch.mjs";
import { connectOrderGrantOwner } from "../scripts/order-zero-direct-execution-owner.mjs";
import { createOrderZeroDirectReleaseScope } from "../scripts/order-zero-direct-release-scope.mjs";
import { createOrderZeroDirectFileFence } from "../scripts/order-zero-direct-release-files.mjs";
import { disposablePrefixHistory } from "../scripts/order-zero-direct-execution-disposable.mjs";
import { correctionProofAppliedRow } from "../scripts/order-correction-release-package-postgres-proof.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test("lifetime watch coalesces checks and joins pending verification before close", async () => {
  const gate = deferred(); let calls = 0, lost = 0;
  const watch = createOrderExecutionWatch({ verify: () => { calls++; return gate.promise; }, onLost: () => { lost++; }, intervalMs: 5 });
  const first = watch.check(), second = watch.check(); assert.equal(first, second);
  await delay(25); assert.equal(calls, 1);
  let closed = false; const closing = watch.close().then(() => { closed = true; });
  await delay(10); assert.equal(closed, false); gate.resolve(); await closing;
  assert.equal(lost, 0); await assert.rejects(watch.check());
});
test("a verification deadline is terminal even if the pending observation later succeeds", async () => {
  const gate = deferred(); let lost = 0;
  const watch = createOrderExecutionWatch({ verify: () => gate.promise, onLost: () => { lost++; }, intervalMs: 5, deadlineMs: 30 });
  await assert.rejects(watch.check(), /preserve attempt/u);
  assert.equal(lost, 1); gate.resolve(); await delay(10);
  await assert.rejects(watch.check()); await assert.rejects(watch.close()); assert.equal(lost, 1);
});
test("background loss poisons the lifetime while its owner is awaiting unrelated work", async () => {
  const loss = deferred(); let valid = true, calls = 0;
  const watch = createOrderExecutionWatch({ verify: () => { calls++; assert.ok(valid); }, onLost: loss.resolve, intervalMs: 5 });
  await watch.check(); valid = false; await loss.promise;
  assert.ok(calls >= 2); assert.throws(watch.assertLive); await assert.rejects(watch.close());
});

const ownerIdentity = { database: "neondb", actor: "neondb_owner", login: "neondb_owner", read_only: "off" };
test("grant owner is a distinct writable session with verified identity and no default-setting override", async () => {
  for (const bad of [undefined, { database: "elsewhere" }, { actor: "grainline_app_runtime" }, { login: "other" }, { read_only: "on" }]) {
    const events = []; let options;
    class Client {
      constructor(value) { options = value; }
      on(event, handler) { assert.equal(event, "error"); assert.equal(typeof handler, "function"); }
      async connect() { events.push("connect"); }
      async query(sql) { events.push(sql); return { rows: [{ ...ownerIdentity, ...bad }] }; }
      async end() { events.push("end"); }
    }
    const connecting = connectOrderGrantOwner({ Client, databaseUrl: "postgresql://fixture.invalid/no-connection",
      channelBinding: () => ({ enableChannelBinding: true }), guard: () => { events.push("guard"); }, onLost: () => {} });
    if (bad) { await assert.rejects(connecting); assert.equal(events.at(-1), "end"); }
    else { const client = await connecting; assert.equal(events.at(-1), "guard"); await client.end(); }
    assert.equal(options.options, undefined); assert.equal(options.enableChannelBinding, true);
    assert.equal(options.application_name, "grainline-order-prefix-grants");
    assert.equal(events.filter(e => e.startsWith("SELECT")).length, 1);
    assert.equal(events[0], "guard"); assert.ok(!events.some(e => e.startsWith("SET")));
  }
});
test("admission loss while grant connection is opening closes it before returning a mutator", async () => {
  let live = true, ended = false, queried = false;
  class Client { on() {} async connect() { live = false; } async query() { queried = true; } async end() { ended = true; } }
  await assert.rejects(connectOrderGrantOwner({ Client, databaseUrl: "postgresql://fixture.invalid/no-connection",
    channelBinding: () => ({}), guard: () => assert.ok(live), onLost: () => {} }));
  assert.equal(ended, true); assert.equal(queried, false);
});

const manifest = createOrderZeroDirectReleaseScope().manifest;
function removeOwned(directory) {
  fs.chmodSync(directory, 0o700);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) removeOwned(path.join(directory, entry.name));
  fs.rmSync(directory, { recursive: true, force: true });
}
// Real executor, manifest, immutable artifact and durable journal. Admission,
// server snapshots and commands are controlled fixtures, never live authority.
function fixture(t, initialPrefix = 0, fault = "") {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "order-admitted-test-")); fs.chmodSync(parent, 0o700);
  t.after(() => removeOwned(parent));
  const payload = { admission: { runId: "1", runAttempt: "1", jobId: "2" }, ci: { ciRunId: "3", ciRunAttempt: "1" },
    githubToken: "fixture-token", ownerUrl: "postgresql://fixture.invalid/no-connection", ownerUrlSha256: "b".repeat(64) };
  const expected = structuredClone(payload), events = [], loss = deferred(); let prefix = initialPrefix, valid = fault !== "initial", losses = 0;
  const assertBound = bound => { assert.deepEqual(bound, expected); assert.ok(Object.isFrozen(bound) && Object.isFrozen(bound.admission) && Object.isFrozen(bound.ci)); };
  const execute = createOrderAdmittedExecutor({ sourceRoot: fs.realpathSync(process.cwd()), parent,
    binding: { releaseCommit: "a".repeat(40), sourceCatalogSha256: "b".repeat(64) }, files: createOrderZeroDirectFileFence(),
    scope: { manifest, assertAuditedSnapshot: (s, stage, mode) => {
      assert.equal(mode, "production"); if (stage === "after") assert.equal(s.prefixLength, 17); return s;
    } },
    admit: async bound => { assertBound(bound); assert.ok(valid); },
    readAudited: async bound => { assertBound(bound); events.push("read");
      if (fault === "scope-loss") valid = false;
      const rows = [...manifest.base, ...manifest.members.slice(0, prefix)].map(r => correctionProofAppliedRow(r.migration_name, r.checksum));
      return { prefixLength: prefix, ledgerRows: disposablePrefixHistory(rows, manifest) };
    },
    connect: async bound => { assertBound(bound); events.push("connect"); return {
      query: async sql => {
        events.push(sql.startsWith("REVOKE") ? "grants" : sql);
        if ((sql.startsWith("REVOKE") && fault === "grant-loss") || (sql === "BEGIN" && fault === "begin-loss")
          || (sql === "COMMIT" && fault === "commit-loss")) valid = false;
      },
      end: async () => { events.push("end"); },
    }; },
    prisma: async (bound, args, checkpoint) => {
      assertBound(bound); events.push(args[1]); await checkpoint();
      if (fault === "pending-command-loss") { valid = false; await loss.promise; return; }
      if (args[1] === "deploy") prefix = 17;
    }, onLost: () => { losses++; loss.resolve(); },
  });
  return { execute, payload, events, parent, losses: () => losses,
    saved: () => JSON.parse(fs.readFileSync(path.join(parent, fs.readdirSync(parent).find(n => n.startsWith("execution-journal-")), "execution.json"))) };
}
test("one bound admission owns fresh staging, execution and every final obligation including prefix 17", async t => {
  for (const prefix of [0, 17]) {
    const f = fixture(t, prefix); const executing = f.execute(f.payload);
    f.payload.admission.runId = "changed-after-start"; f.payload.ci.ciRunId = "changed-after-start"; f.payload.ownerUrl = "changed-after-start";
    const result = await executing; assert.equal(result.appliedMemberCount, 17 - prefix);
    assert.equal(result.productionExecutionAuthorized, false); assert.equal(f.saved().stage, "complete");
    assert.equal(f.events.filter(e => e === "read").length, 6);
    assert.equal(f.events.filter(e => e === "deploy").length, prefix === 0 ? 1 : 0);
    assert.ok(f.events.includes("grants") && f.events.includes("COMMIT") && f.events.includes("status"));
    await assert.rejects(f.execute(f.payload), /resumed or replayed/u);
  }
});
test("connection loss at transaction boundaries stops later SQL and retains ambiguous commit intent", async t => {
  for (const fault of ["begin-loss", "commit-loss"]) {
    const f = fixture(t, 17, fault); await assert.rejects(f.execute(f.payload));
    assert.equal(f.saved().stage, "grant-intent"); assert.ok(f.events.includes("end") && !f.events.includes("status"));
    if (fault === "begin-loss") assert.ok(!f.events.includes("grants"));
    else assert.ok(f.events.includes("COMMIT")); // A post-COMMIT loss cannot claim the write rolled back.
    await assert.rejects(f.execute(f.payload), /resumed or replayed/u);
  }
});
test("initial or scope admission loss prevents staging or any mutator", async t => {
  for (const fault of ["initial", "scope-loss"]) {
    const f = fixture(t, 0, fault); await assert.rejects(f.execute(f.payload));
    assert.deepEqual(fs.readdirSync(f.parent), []); assert.ok(!f.events.includes("connect") && !f.events.includes("deploy"));
    assert.equal(f.losses(), 1);
  }
});
test("loss during a pending command or grant transaction preserves intent and never commits or replays", async t => {
  for (const [fault, stage] of [["pending-command-loss", "apply-intent"], ["grant-loss", "grant-intent"]]) {
    const f = fixture(t, 0, fault); await assert.rejects(f.execute(f.payload));
    assert.equal(f.saved().stage, stage); assert.equal(f.losses(), 1); assert.ok(!f.events.includes("COMMIT") && !f.events.includes("status"));
    if (fault === "grant-loss") assert.ok(f.events.includes("ROLLBACK") && f.events.includes("end"));
    await assert.rejects(f.execute(f.payload), /resumed or replayed/u);
    assert.equal(f.events.filter(e => e === "deploy").length, 1);
  }
});
