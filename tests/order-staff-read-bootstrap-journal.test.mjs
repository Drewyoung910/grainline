import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { withStaffBootstrapJournal, STAFF_JOURNAL_FILES } from "../scripts/order-staff-read-bootstrap-journal.mjs";
import { newStaffBootstrapState, runStaffBootstrapCore, staffBootstrapMarker, STAFF_BOOTSTRAP_ROLE } from "../scripts/order-staff-read-role-bootstrap.mjs";

const binding = { releaseCommit: "a".repeat(40), ciRunId: "34010014880" };
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-staff-journal-test-")));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, binding };
}
const file = (options, key) => path.join(options.directory, STAFF_JOURNAL_FILES[key]);
const denial = /private journal stopped; preserve files/u;

test("private journal persists immutable credential and monotonic stages across restart", async (t) => {
  const options = fixture(t);
  const state = newStaffBootstrapState(binding);
  await withStaffBootstrapJournal(options, (journal) => {
    assert.equal(journal.read(), null);
    journal.persistPrivateState(state);
    assert.ok(JSON.stringify(journal.read()) === JSON.stringify(state));
    journal.persistPrivateState({ ...state, stage: "create-pending" });
    assert.equal(fs.statSync(file(options, "state")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(file(options, "lock")).mode & 0o777, 0o600);
  });
  await withStaffBootstrapJournal(options, (journal) => {
    assert.equal(journal.read().stage, "create-pending");
    assert.ok(journal.read().password === state.password);
    journal.persistPrivateState({ ...state, stage: "role-verified" });
    journal.persistPrivateState({ ...state, stage: "role-verified" });
  });
  assert.deepEqual(fs.readdirSync(options.directory), [STAFF_JOURNAL_FILES.state]);
});

test("journal and core retain intent after ambiguous SQL, then authenticate same credential", async (t) => {
  const options = fixture(t);
  const state = newStaffBootstrapState(binding);
  await assert.rejects(withStaffBootstrapJournal(options, async (journal) => {
    journal.persistPrivateState(state);
    await runStaffBootstrapCore({ state, binding, operations: {
      persistPrivateState: journal.persistPrivateState,
      async executeOwnerTransaction() {
        assert.equal(journal.read().stage, "create-pending");
        throw new Error(state.password);
      },
      async proveSeparateLogin() { assert.fail("SQL failure must stop login"); },
    } });
  }), denial);
  await withStaffBootstrapJournal(options, async (journal) => {
    assert.equal(journal.read().stage, "create-pending");
    const result = await runStaffBootstrapCore({ state: journal.read(), binding, operations: {
      persistPrivateState: journal.persistPrivateState,
      async executeOwnerTransaction() { assert.ok(journal.read().password === state.password); },
      async proveSeparateLogin(password) {
        assert.ok(password === state.password);
        return { currentUser: STAFF_BOOTSTRAP_ROLE, sessionUser: STAFF_BOOTSTRAP_ROLE,
          database: "neondb", marker: staffBootstrapMarker(state), restrictedRole: true, hasApplicationAuthority: false };
      },
    } });
    assert.equal(result.status, "role-verified");
    assert.ok(!JSON.stringify(result).includes(state.password));
  });
});

test("competing holder is rejected; retained adapter cannot write after lock release", async (t) => {
  const options = fixture(t);
  let retained;
  await withStaffBootstrapJournal(options, async (journal) => {
    retained = journal;
    const lock = fs.readFileSync(file(options, "lock"), "utf8");
    await assert.rejects(withStaffBootstrapJournal(options, () => assert.fail("competing holder")), denial);
    assert.equal(fs.readFileSync(file(options, "lock"), "utf8"), lock);
    journal.persistPrivateState(newStaffBootstrapState(binding));
  });
  assert.throws(() => retained.persistPrivateState(newStaffBootstrapState(binding)), denial);
});

test("attempt, secret, binding and backwards or skipped stages fail closed", async (t) => {
  for (const kind of ["attempt", "binding", "backwards", "skip"]) {
    const options = fixture(t);
    const state = newStaffBootstrapState(binding);
    await withStaffBootstrapJournal(options, (journal) => {
      journal.persistPrivateState(state);
      if (kind === "backwards") journal.persistPrivateState({ ...state, stage: "create-pending" });
    });
    const before = fs.readFileSync(file(options, "state"), "utf8");
    const next = kind === "attempt" ? newStaffBootstrapState(binding) : kind === "binding"
      ? newStaffBootstrapState({ ...binding, ciRunId: "123" })
      : { ...state, stage: kind === "skip" ? "role-verified" : "prepared" };
    await assert.rejects(withStaffBootstrapJournal(options, (journal) => journal.persistPrivateState(next)), denial);
    assert.ok(fs.readFileSync(file(options, "state"), "utf8") === before);
  }
});

test("symlinks, hardlinks, nonprivate files and nonprivate or aliased directories are refused", async (t) => {
  for (const kind of ["symlink", "hardlink", "mode", "directory-mode", "directory-alias", "malformed", "oversized"]) {
    const options = fixture(t);
    const target = path.join(options.directory, "sentinel");
    fs.writeFileSync(target, "sentinel unchanged", { mode: 0o600 });
    if (kind === "symlink") fs.symlinkSync(target, file(options, "state"));
    if (kind === "hardlink") fs.linkSync(target, file(options, "state"));
    if (["mode", "malformed", "oversized"].includes(kind)) {
      fs.writeFileSync(file(options, "state"), kind === "oversized" ? "x".repeat(9000) : "invalid secret-bearing JSON", { mode: 0o600 });
      if (kind === "mode") fs.chmodSync(file(options, "state"), 0o644);
    }
    let effective = options;
    if (kind === "directory-mode") fs.chmodSync(options.directory, 0o755);
    if (kind === "directory-alias") {
      const alias = path.join(options.directory, "alias");
      fs.symlinkSync(options.directory, alias);
      effective = { ...options, directory: alias };
    }
    await assert.rejects(withStaffBootstrapJournal(effective, () => assert.fail("unsafe path accepted")), (error) => {
      assert.match(error.message, denial);
      assert.ok(!error.message.includes("secret-bearing"));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.equal(fs.readFileSync(target, "utf8"), "sentinel unchanged");
  }
});

test("stranded pending write is preserved and never silently adopted", async (t) => {
  const options = fixture(t);
  const state = newStaffBootstrapState(binding);
  await withStaffBootstrapJournal(options, (journal) => journal.persistPrivateState(state));
  fs.writeFileSync(file(options, "pending"), JSON.stringify({ ...state, stage: "create-pending" }), { mode: 0o600 });
  await assert.rejects(withStaffBootstrapJournal(options, () => assert.fail("stranded write accepted")), denial);
  assert.equal(JSON.parse(fs.readFileSync(file(options, "state"))).stage, "prepared");
  assert.equal(JSON.parse(fs.readFileSync(file(options, "pending"))).stage, "create-pending");
});

test("journal replacement under a held lock poisons adapter without overwriting replacement", async (t) => {
  const options = fixture(t);
  await withStaffBootstrapJournal(options, (journal) => {
    const state = newStaffBootstrapState(binding);
    journal.persistPrivateState(state);
    const replacement = JSON.stringify(newStaffBootstrapState(binding));
    fs.writeFileSync(file(options, "state"), replacement);
    assert.throws(() => journal.persistPrivateState({ ...state, stage: "create-pending" }), denial);
    assert.throws(() => journal.read(), denial);
    assert.ok(fs.readFileSync(file(options, "state"), "utf8") === replacement);
  });
});

test("real process crash retains private intent and stale lock; restart never steals it", async (t) => {
  const options = fixture(t);
  const journalUrl = new URL("../scripts/order-staff-read-bootstrap-journal.mjs", import.meta.url).href;
  const coreUrl = new URL("../scripts/order-staff-read-role-bootstrap.mjs", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { withStaffBootstrapJournal } from ${JSON.stringify(journalUrl)};
    import { newStaffBootstrapState } from ${JSON.stringify(coreUrl)};
    const options = ${JSON.stringify(options)};
    await withStaffBootstrapJournal(options, (journal) => {
      const state = newStaffBootstrapState(options.binding);
      journal.persistPrivateState(state);
      journal.persistPrivateState({ ...state, stage: "create-pending" });
      process.kill(process.pid, "SIGKILL");
    });
  `], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.signal, "SIGKILL");
  assert.equal(child.stdout, "");
  const before = fs.readFileSync(file(options, "state"), "utf8");
  assert.equal(JSON.parse(before).stage, "create-pending");
  assert.equal(fs.statSync(file(options, "state")).mode & 0o777, 0o600);
  await assert.rejects(withStaffBootstrapJournal(options, () => assert.fail("stale lock stolen")), denial);
  assert.ok(fs.readFileSync(file(options, "state"), "utf8") === before);
  assert.ok(fs.existsSync(file(options, "lock")));
});

test("file sync, rename and directory sync failures prevent SQL and preserve recovery state", async (t) => {
  for (const phase of ["file-sync", "rename", "directory-sync"]) {
    const options = fixture(t);
    const state = newStaffBootstrapState(binding);
    let sqlCalls = 0;
    await assert.rejects(withStaffBootstrapJournal(options, async (journal) => {
      journal.persistPrivateState(state);
      const method = phase === "rename" ? "renameSync" : "fsyncSync";
      const original = fs[method];
      let calls = 0;
      const mocked = t.mock.method(fs, method, (...args) => {
        calls += 1;
        if (calls === (phase === "directory-sync" ? 2 : 1)) throw new Error(state.password);
        return original(...args);
      });
      try {
        await runStaffBootstrapCore({ state, binding, operations: {
          persistPrivateState: journal.persistPrivateState,
          async executeOwnerTransaction() { sqlCalls += 1; },
          async proveSeparateLogin() { assert.fail("uncertain persistence must stop login"); },
        } });
      } finally { mocked.mock.restore(); }
    }), error => {
      assert.match(error.message, denial);
      assert.ok(!error.message.includes(state.password));
      return true;
    });
    assert.equal(sqlCalls, 0);
    assert.equal(JSON.parse(fs.readFileSync(file(options, "state"))).stage,
      phase === "directory-sync" ? "create-pending" : "prepared");
    assert.equal(fs.existsSync(file(options, "pending")), phase !== "directory-sync");
  }
});
