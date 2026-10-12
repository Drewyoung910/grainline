import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  newAccountDeletionBootstrapState,
  retireAccountDeletionBootstrapCredential,
} from "../scripts/account-deletion-worker-role-bootstrap.mjs";
import { accountDeletionReleaseFixture } from "./helpers/account-deletion-bootstrap-release-fixture.mjs";
import { withAccountDeletionBootstrapJournal } from "../scripts/account-deletion-worker-bootstrap-journal.mjs";
import {
  ACCOUNT_DELETION_VERCEL_ENV_AUTHORITY,
  accountDeletionVercelOperatorSourceDirectory,
  executeAccountDeletionVercelEnvironmentWithInputs,
  runAccountDeletionVercelEnvironmentFromApprovedManifest,
} from "../scripts/account-deletion-worker-vercel-env-operator.mjs";

const reviewed = Object.freeze(accountDeletionReleaseFixture().reviewed);
const binding = { releaseCommit: reviewed.releaseCommit, ciRunId: reviewed.ciRunId };

function fixture(t, stage = "role-verified") {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-account-deletion-vercel-operator-")));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prepared = newAccountDeletionBootstrapState(binding);
  const verified = { ...prepared, stage: "role-verified" };
  const state = stage === "credential-installed"
    ? retireAccountDeletionBootstrapCredential(verified, binding, {
      status: "installed", key: "ACCOUNT_DELETION_DATABASE_URL",
      environmentId: "env_fixture_1", valueSha256: "c".repeat(64),
    })
    : { ...prepared, stage };
  return withAccountDeletionBootstrapJournal({ directory, binding }, journal => {
    journal.persistPrivateState(prepared);
    if (stage !== "prepared") journal.persistPrivateState({ ...prepared, stage: "create-pending" });
    if (["role-verified", "credential-installed"].includes(stage)) journal.persistPrivateState(verified);
    if (stage === "credential-installed") journal.persistPrivateState(state);
  }).then(() => ({ directory, state }));
}

test("provider composition re-attests before and after one exact install and returns sanitized evidence", async t => {
  const { directory, state } = await fixture(t);
  const calls = [];
  const inputs = { reviewed, directory, manifestSha256: "b".repeat(64),
    verifyManifest() { calls.push("manifest"); return true; },
    loadProviderTokens() { calls.push("tokens"); return { github: "github-token", vercel: "vercel-token" }; },
    retireProviderTokens() { calls.push("retire-tokens"); return { status: "retired" }; },
    observeCredentialEpoch() { return { status: "complete" }; } };
  const result = await executeAccountDeletionVercelEnvironmentWithInputs(inputs, {
    sourceDirectory: "/repo",
    async collectObservations() { calls.push("observe"); return {}; },
    async install(args) {
      calls.push("install");
      assert.equal(args.state.attemptId, state.attemptId);
      assert.equal(args.vercelToken, "vercel-token");
      return { status: "installed", key: "ACCOUNT_DELETION_DATABASE_URL",
        environmentId: "env_fixture_1", valueSha256: "c".repeat(64) };
    },
  });
  assert.deepEqual(calls, ["manifest", "observe", "manifest", "tokens", "install", "observe", "manifest", "retire-tokens", "manifest"]);
  assert.equal(result.attemptId, state.attemptId);
  assert.ok(!JSON.stringify(result).includes(state.password));
  assert.equal(result.localCredentialRetired, true);
  assert.equal(result.providerTokensRetired, true);
  await withAccountDeletionBootstrapJournal({ directory, binding }, journal => {
    const terminal = journal.read();
    assert.equal(terminal.stage, "credential-installed");
    assert.equal(terminal.password, undefined);
    assert.equal(terminal.verifier, undefined);
    assert.match(terminal.passwordSha256, /^[0-9a-f]{64}$/u);
  });
});

test("provider retry completes token retirement from sanitized terminal state", async t => {
  const { directory, state } = await fixture(t, "credential-installed");
  const calls = [];
  const result = await executeAccountDeletionVercelEnvironmentWithInputs({
    reviewed, directory, manifestSha256: "b".repeat(64),
    verifyManifest() { calls.push("manifest"); },
    loadProviderTokens() { assert.fail("terminal retry must not reload provider tokens"); },
    retireProviderTokens() { calls.push("retire-tokens"); return { status: "retired" }; },
    observeCredentialEpoch() { assert.fail("terminal retry must not repeat provider admission"); },
  }, { sourceDirectory: "/repo",
    collectObservations: async () => assert.fail("terminal retry must not repeat provider reads"),
    install: async () => assert.fail("terminal retry must not reinstall") });
  assert.deepEqual(calls, ["manifest", "manifest", "retire-tokens", "manifest"]);
  assert.equal(result.environmentId, state.environmentId);
  assert.equal(result.localCredentialRetired, true);
});

test("provider step requires the terminal exact attempt and preserves it on failure", async t => {
  for (const stage of ["prepared", "create-pending"]) {
    const { directory } = await fixture(t, stage);
    let installed = false;
    await assert.rejects(executeAccountDeletionVercelEnvironmentWithInputs({ reviewed, directory,
      manifestSha256: "b".repeat(64), verifyManifest() {}, loadProviderTokens() { return {}; },
      retireProviderTokens() {},
      observeCredentialEpoch() {} }, { sourceDirectory: "/repo", collectObservations: async () => ({}),
      install: async () => { installed = true; } }), /operator stopped/u);
    assert.equal(installed, false);
  }
});

test("provider operator source and confirmation are fixed", async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-account-deletion-vercel-source-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, "repo");
  fs.mkdirSync(path.join(repository, "scripts"), { recursive: true });
  const script = path.join(repository, "scripts", "account-deletion-worker-vercel-env-operator.mjs");
  fs.writeFileSync(script, "// fixture\n");
  assert.equal(accountDeletionVercelOperatorSourceDirectory(pathToFileURL(script).href, repository), repository);
  assert.throws(() => accountDeletionVercelOperatorSourceDirectory(pathToFileURL(script).href, root));
  assert.equal(ACCOUNT_DELETION_VERCEL_ENV_AUTHORITY, "install-account-deletion-production-database-url-only");
  await assert.rejects(runAccountDeletionVercelEnvironmentFromApprovedManifest({
    manifestSha256: "a".repeat(64), confirmation: "broader-authority",
  }), /operator stopped/u);
});
