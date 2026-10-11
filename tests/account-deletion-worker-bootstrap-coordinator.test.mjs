import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { coordinateAccountDeletionBootstrap } from "../scripts/account-deletion-worker-bootstrap-coordinator.mjs";
import { ACCOUNT_DELETION_BOOTSTRAP_ROLE, accountDeletionBootstrapMarker } from "../scripts/account-deletion-worker-role-bootstrap.mjs";
import { ACCOUNT_DELETION_JOURNAL_FILES } from "../scripts/account-deletion-worker-bootstrap-journal.mjs";
import { accountDeletionReleaseFixture } from "./helpers/account-deletion-bootstrap-release-fixture.mjs";

function fixture(t) {
  const release = accountDeletionReleaseFixture();
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-account-deletion-coordinator-test-")));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const options = {
    reviewed: release.reviewed, directory, env: {},
    async observeRelease() { calls.push("attest"); return release; },
    async loadOwnerCredential() { calls.push("credential"); return { url: "private fixture URL",
      epochSha256: release.reviewed.credentialEpochSha256 }; },
    connectionFactory({ state }) {
      calls.push("connection-factory");
      return {
        async executeOwnerTransaction(sql) {
          calls.push("owner");
          const persisted = JSON.parse(fs.readFileSync(path.join(directory, ACCOUNT_DELETION_JOURNAL_FILES.state), "utf8"));
          assert.equal(persisted.stage, "create-pending");
          assert.ok(persisted.password === state.password && persisted.attemptId === state.attemptId);
          assert.ok(!sql.includes(state.password));
        },
        async proveSeparateLogin(password) {
          calls.push("login");
          assert.ok(password === state.password);
          return { currentUser: ACCOUNT_DELETION_BOOTSTRAP_ROLE, sessionUser: ACCOUNT_DELETION_BOOTSTRAP_ROLE,
            database: "neondb", marker: accountDeletionBootstrapMarker(state), restrictedRole: true, hasApplicationAuthority: false };
        },
      };
    },
  };
  const read = () => JSON.parse(fs.readFileSync(path.join(directory, ACCOUNT_DELETION_JOURNAL_FILES.state), "utf8"));
  return { release, directory, options, calls, read };
}

test("coordinator composes admitted release, durable intent, separate login and final attestation", async t => {
  const f = fixture(t);
  const result = await coordinateAccountDeletionBootstrap(f.options);
  assert.deepEqual(f.calls, ["attest", "credential", "connection-factory", "attest", "owner", "attest", "login", "attest"]);
  assert.equal(result.status, "role-verified");
  assert.equal(result.tlsProofRunId, f.release.reviewed.tlsProofRunId);
  assert.equal(result.secretInstalled, false);
  assert.equal(result.grantsApplied, false);
  assert.equal(result.productionDeploymentChanged, false);
  assert.ok(!JSON.stringify(result).includes(f.read().password));
  assert.equal(f.read().stage, "role-verified");
  assert.deepEqual(fs.readdirSync(f.directory), [ACCOUNT_DELETION_JOURNAL_FILES.state]);
});

test("bad initial release or credential epoch cannot reach a connection or create private state", async t => {
  for (const kind of ["release", "credential"]) {
    const f = fixture(t);
    if (kind === "release") f.release.tlsProofJob.steps[1].conclusion = "skipped";
    else f.options.loadOwnerCredential = async () => ({ url: "private", epochSha256: "wrong" });
    await assert.rejects(coordinateAccountDeletionBootstrap(f.options), /coordinator stopped/u);
    assert.ok(!f.calls.includes("connection-factory"));
    assert.deepEqual(fs.readdirSync(f.directory), []);
  }
});

test("release drift before SQL, login or final receipt stops at that boundary and preserves state", async t => {
  for (const phase of [2, 3, 4]) {
    const f = fixture(t);
    let observations = 0;
    const original = f.options.observeRelease;
    f.options.observeRelease = async () => {
      if (++observations === phase) f.release.deployment.aliases[0].deploymentId = "different";
      return original();
    };
    await assert.rejects(coordinateAccountDeletionBootstrap(f.options), /preserve the exact private attempt/u);
    assert.equal(f.calls.includes("owner"), phase > 2);
    assert.equal(f.calls.includes("login"), phase > 3);
    assert.equal(f.read().stage, phase === 4 ? "role-verified" : "create-pending");
  }
});

test("ambiguous owner failure preserves exact attempt and terminal resume does no owner SQL", async t => {
  const f = fixture(t);
  const original = f.options.connectionFactory;
  let firstPassword;
  f.options.connectionFactory = params => {
    firstPassword = params.state.password;
    return { ...original(params), async executeOwnerTransaction() { throw new Error(firstPassword); } };
  };
  await assert.rejects(coordinateAccountDeletionBootstrap(f.options), error => {
    assert.ok(!error.message.includes(firstPassword));
    assert.equal(error.cause, undefined);
    return /preserve the exact private attempt/u.test(error.message);
  });
  assert.equal(f.read().stage, "create-pending");
  assert.ok(f.read().password === firstPassword);
  f.options.connectionFactory = original;
  await coordinateAccountDeletionBootstrap(f.options);
  const count = f.calls.filter(value => value === "owner").length;
  await coordinateAccountDeletionBootstrap(f.options);
  assert.equal(f.calls.filter(value => value === "owner").length, count);
  assert.ok(f.read().password === firstPassword);
});

test("observation callbacks cannot substitute or mutate the admitted review binding", async t => {
  const f = fixture(t);
  f.options.observeRelease = async () => {
    f.release.reviewed.releaseCommit = "b".repeat(40);
    f.release.git.head = f.release.reviewed.releaseCommit;
    f.release.git.remoteMain = f.release.reviewed.releaseCommit;
    f.release.ci.head_sha = f.release.reviewed.releaseCommit;
    return f.release;
  };
  await assert.rejects(coordinateAccountDeletionBootstrap(f.options), /release-admission/u);
  assert.deepEqual(fs.readdirSync(f.directory), []);
  assert.equal(f.calls.length, 0);
});

test("a second coordinator cannot load credentials or operate while the journal is locked", async t => {
  const f = fixture(t);
  const original = f.options.connectionFactory;
  let attempted = false;
  f.options.connectionFactory = params => ({ ...original(params),
    async executeOwnerTransaction(sql) {
      if (!attempted) {
        attempted = true;
        await assert.rejects(coordinateAccountDeletionBootstrap(f.options), /private-journal/u);
      }
      await original(params).executeOwnerTransaction(sql);
    },
  });
  await coordinateAccountDeletionBootstrap(f.options);
  assert.equal(f.calls.filter(value => value === "credential").length, 1);
  assert.equal(f.calls.filter(value => value === "owner").length, 1);
});
