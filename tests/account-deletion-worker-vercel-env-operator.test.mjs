import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { newAccountDeletionBootstrapState } from "../scripts/account-deletion-worker-role-bootstrap.mjs";
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
  const state = { ...prepared, stage };
  return withAccountDeletionBootstrapJournal({ directory, binding }, journal => {
    journal.persistPrivateState(prepared);
    if (stage !== "prepared") journal.persistPrivateState({ ...prepared, stage: "create-pending" });
    if (stage === "role-verified") journal.persistPrivateState(state);
  }).then(() => ({ directory, state }));
}

test("provider composition re-attests before and after one exact install and returns sanitized evidence", async t => {
  const { directory, state } = await fixture(t);
  const calls = [];
  const inputs = { reviewed, directory, manifestSha256: "b".repeat(64),
    verifyManifest() { calls.push("manifest"); return true; },
    loadProviderTokens() { calls.push("tokens"); return { github: "github-token", vercel: "vercel-token" }; },
    observeCredentialEpoch() { return { status: "complete" }; } };
  const result = await executeAccountDeletionVercelEnvironmentWithInputs(inputs, {
    sourceDirectory: "/repo",
    async collectObservations() { calls.push("observe"); return {}; },
    async install(args) {
      calls.push("install");
      assert.equal(args.state.attemptId, state.attemptId);
      assert.equal(args.vercelToken, "vercel-token");
      return { status: "installed", key: "ACCOUNT_DELETION_DATABASE_URL", valueSha256: "c".repeat(64) };
    },
  });
  assert.deepEqual(calls, ["manifest", "observe", "manifest", "tokens", "install", "observe", "manifest"]);
  assert.equal(result.attemptId, state.attemptId);
  assert.ok(!JSON.stringify(result).includes(state.password));
});

test("provider step requires the terminal exact attempt and preserves it on failure", async t => {
  for (const stage of ["prepared", "create-pending"]) {
    const { directory } = await fixture(t, stage);
    let installed = false;
    await assert.rejects(executeAccountDeletionVercelEnvironmentWithInputs({ reviewed, directory,
      manifestSha256: "b".repeat(64), verifyManifest() {}, loadProviderTokens() { return {}; },
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
