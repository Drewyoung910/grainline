import assert from "node:assert/strict";
import test from "node:test";
import {
  newAccountDeletionBootstrapState, validateAccountDeletionBootstrapState, buildAccountDeletionBootstrapSql,
  runAccountDeletionBootstrapCore, ACCOUNT_DELETION_BOOTSTRAP_ROLE, accountDeletionBootstrapMarker,
  readAccountDeletionBootstrapLoginSnapshot,
} from "../scripts/account-deletion-worker-role-bootstrap.mjs";

const binding = { releaseCommit: "a".repeat(40), ciRunId: "34010014880" };

function fixture(stage = "prepared") {
  const state = { ...newAccountDeletionBootstrapState(binding), stage };
  const calls = [];
  let saved;
  const login = {
    currentUser: ACCOUNT_DELETION_BOOTSTRAP_ROLE, sessionUser: ACCOUNT_DELETION_BOOTSTRAP_ROLE,
    database: "neondb", restrictedRole: true, hasApplicationAuthority: false,
    marker: accountDeletionBootstrapMarker(state),
  };
  const operations = {
    async persistPrivateState(value) { saved = value; calls.push(value.stage); },
    async executeOwnerTransaction(sql) {
      assert.equal(saved.stage, "create-pending");
      assert.ok(!sql.includes(state.password));
      calls.push("sql");
    },
    async proveSeparateLogin(password) {
      assert.ok(password === state.password);
      calls.push("login");
      return login;
    },
  };
  return { state, operations, calls, login, getSaved: () => saved };
}

test("account deletion bootstrap binds exact private state and refuses drift", () => {
  const state = newAccountDeletionBootstrapState(binding);
  assert.equal(validateAccountDeletionBootstrapState(state, binding).role, ACCOUNT_DELETION_BOOTSTRAP_ROLE);
  for (const patch of [
    { version: 2 }, { role: "grainline_app_runtime" }, { stage: "secret-installed" },
    { password: "0".repeat(64) }, { verifier: "plaintext" }, { attemptId: "';--" },
    { releaseCommit: "b".repeat(40) }, { ciRunId: "1" }, { extra: true },
  ]) assert.throws(() => validateAccountDeletionBootstrapState({ ...state, ...patch }, binding));
  assert.throws(() => newAccountDeletionBootstrapState({ ...binding, ciRunId: 123 }));
});

test("bootstrap persists intent before SQL and authenticates before completion", async () => {
  const f = fixture();
  const evidence = await runAccountDeletionBootstrapCore({ ...f, binding });
  assert.deepEqual(f.calls, ["create-pending", "sql", "login", "role-verified"]);
  assert.equal(evidence.grantsApplied, false);
  assert.equal(evidence.secretInstalled, false);
  assert.ok(!JSON.stringify(evidence).includes(f.state.password));
  assert.ok(!JSON.stringify(evidence).includes(f.state.verifier));
});

test("lost SQL response preserves the exact pending credential for recovery", async () => {
  const f = fixture();
  f.operations.executeOwnerTransaction = async () => { throw new Error(f.state.password); };
  await assert.rejects(runAccountDeletionBootstrapCore({ ...f, binding }), error => {
    assert.ok(!error.message.includes(f.state.password));
    assert.equal(error.cause, undefined);
    assert.match(error.message, /during owner-transaction/u);
    return /preserve the private journal/u.test(error.message);
  });
  assert.equal(f.getSaved().stage, "create-pending");
  assert.ok(f.getSaved().password === f.state.password);
  assert.ok(!f.calls.includes("login"));
});

test("failed intent persistence prevents any SQL or authentication", async () => {
  const f = fixture();
  f.operations.persistPrivateState = async () => { throw new Error("disk unavailable"); };
  await assert.rejects(runAccountDeletionBootstrapCore({ ...f, binding }));
  assert.deepEqual(f.calls, []);
});

test("pending restart reuses credential; terminal restart performs no SQL", async () => {
  for (const stage of ["create-pending", "role-verified"]) {
    const f = fixture(stage);
    await runAccountDeletionBootstrapCore({ ...f, binding });
    assert.equal(f.calls.filter(call => call === "sql").length, stage === "role-verified" ? 0 : 1);
    assert.equal(f.calls.filter(call => call === "login").length, 1);
    assert.ok(f.getSaved().password === f.state.password);
  }
});

test("every separate-login identity and authority mismatch stops completion", async () => {
  for (const patch of [
    { currentUser: "neondb_owner" }, { sessionUser: "neondb_owner" },
    { database: "other" }, { restrictedRole: false }, { hasApplicationAuthority: true },
    { marker: "another-attempt" }, { hasApplicationAuthority: "false" },
  ]) {
    const f = fixture();
    Object.assign(f.login, patch);
    await assert.rejects(runAccountDeletionBootstrapCore({ ...f, binding }));
    assert.equal(f.getSaved().stage, "create-pending");
  }
});

test("completion persistence failure remains recoverable without password replacement", async () => {
  const f = fixture();
  const persist = f.operations.persistPrivateState;
  f.operations.persistPrivateState = async value => {
    if (value.stage === "role-verified") throw new Error("fsync failed");
    await persist(value);
  };
  await assert.rejects(runAccountDeletionBootstrapCore({ ...f, binding }));
  assert.equal(f.getSaved().stage, "create-pending");
});

test("bootstrap SQL asks PostgreSQL to hash a bound secret and contains no grants or reset", () => {
  const state = newAccountDeletionBootstrapState(binding);
  const sql = buildAccountDeletionBootstrapSql(state, binding);
  assert.ok(!sql.includes(state.password));
  assert.ok(!sql.includes(state.verifier));
  assert.doesNotMatch(sql, /\b(?:ALTER ROLE|DROP ROLE|GRANT|REVOKE)\b/u);
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.ok(!sql.startsWith("BEGIN;") && !sql.endsWith("COMMIT;"));
  assert.match(sql, /SET LOCAL password_encryption = 'scram-sha-256'/u);
  assert.match(sql, /current_setting\('grainline.account_deletion_bootstrap_password', true\)/u);
  assert.match(sql, /EXCEPTION WHEN OTHERS THEN[^]*RAISE EXCEPTION 'account deletion bootstrap role creation failed'\s+USING ERRCODE = 'P0001'/u);
  assert.doesNotMatch(sql, /EXCEPTION WHEN OTHERS THEN[^]*\bRAISE;/u);
  assert.match(sql, /SET LOCAL lock_timeout/u);
});

test("catalog reader rejects missing/read-write results and always rolls back", async () => {
  for (const rows of [[], [{ read_only: false }]]) {
    const calls = [];
    const client = { async query(sql) {
      calls.push(sql);
      return { rows };
    } };
    await assert.rejects(readAccountDeletionBootstrapLoginSnapshot(client));
    assert.match(calls[0], /REPEATABLE READ READ ONLY/u);
    assert.equal(calls.at(-1), "ROLLBACK");
  }
});
