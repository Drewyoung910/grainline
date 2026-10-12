import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  newAccountDeletionBootstrapState,
  retireAccountDeletionBootstrapCredential,
} from "../scripts/account-deletion-worker-role-bootstrap.mjs";
import { withAccountDeletionBootstrapJournal } from "../scripts/account-deletion-worker-bootstrap-journal.mjs";
import {
  ACCOUNT_DELETION_LOCAL_RETIREMENT_AUTHORITY,
  executeAccountDeletionLocalRetirementWithInputs,
  runAccountDeletionLocalRetirementFromApprovedManifest,
} from "../scripts/account-deletion-worker-local-retirement.mjs";
import { accountDeletionReleaseFixture } from "./helpers/account-deletion-bootstrap-release-fixture.mjs";

const reviewed = Object.freeze(accountDeletionReleaseFixture().reviewed);
const binding = Object.freeze({ releaseCommit: reviewed.releaseCommit, ciRunId: reviewed.ciRunId });
const installation = Object.freeze({
  status: "installed",
  key: "ACCOUNT_DELETION_DATABASE_URL",
  environmentId: "env_fixture_1",
  valueSha256: "c".repeat(64),
});

async function fixture(t, stage = "role-verified") {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "grainline-account-deletion-retirement-")));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prepared = newAccountDeletionBootstrapState(binding);
  const verified = { ...prepared, stage: "role-verified" };
  await withAccountDeletionBootstrapJournal({ directory, binding }, journal => {
    journal.persistPrivateState(prepared);
    if (stage !== "prepared") journal.persistPrivateState({ ...prepared, stage: "create-pending" });
    if (["role-verified", "credential-installed"].includes(stage)) journal.persistPrivateState(verified);
    if (stage === "credential-installed") {
      journal.persistPrivateState(retireAccountDeletionBootstrapCredential(verified, binding, installation));
    }
  });
  return { directory, prepared, verified };
}

test("read-only provider evidence retires local credential and token material", async t => {
  const { directory, verified } = await fixture(t);
  const calls = [];
  const result = await executeAccountDeletionLocalRetirementWithInputs({
    reviewed,
    directory,
    manifestSha256: "b".repeat(64),
    verifyManifest() { calls.push("manifest"); },
    loadProviderTokens() { calls.push("tokens"); return { github: "github-token", vercel: "vercel-token" }; },
    retireProviderTokens() { calls.push("retire-tokens"); return { status: "retired" }; },
  }, {
    async inspect(args) {
      calls.push("inspect");
      assert.equal(args.state.attemptId, verified.attemptId);
      assert.equal(args.vercelToken, "vercel-token");
      return installation;
    },
  });
  assert.deepEqual(calls, ["manifest", "tokens", "inspect", "manifest", "retire-tokens", "manifest"]);
  assert.equal(result.providerMutation, false);
  assert.equal(result.localCredentialRetired, true);
  await withAccountDeletionBootstrapJournal({ directory, binding }, journal => {
    const state = journal.read();
    assert.equal(state.stage, "credential-installed");
    assert.equal(state.password, undefined);
    assert.equal(state.verifier, undefined);
  });
});

test("terminal retry only completes idempotent local token retirement", async t => {
  const { directory } = await fixture(t, "credential-installed");
  const calls = [];
  const result = await executeAccountDeletionLocalRetirementWithInputs({
    reviewed,
    directory,
    manifestSha256: "b".repeat(64),
    verifyManifest() { calls.push("manifest"); },
    loadProviderTokens() { assert.fail("terminal retry must not reload tokens"); },
    retireProviderTokens() { calls.push("retire-tokens"); return { status: "retired" }; },
  }, { inspect: async () => assert.fail("terminal retry must not repeat provider reads") });
  assert.deepEqual(calls, ["manifest", "retire-tokens", "manifest"]);
  assert.equal(result.status, "credential-installed");
});

test("local retirement rejects unverified stages and a broader confirmation", async t => {
  const { directory } = await fixture(t, "create-pending");
  let inspected = false;
  await assert.rejects(executeAccountDeletionLocalRetirementWithInputs({
    reviewed,
    directory,
    manifestSha256: "b".repeat(64),
    verifyManifest() {},
    loadProviderTokens() { return { vercel: "vercel-token" }; },
    retireProviderTokens() {},
  }, { inspect: async () => { inspected = true; } }), /retirement stopped/u);
  assert.equal(inspected, false);
  assert.equal(ACCOUNT_DELETION_LOCAL_RETIREMENT_AUTHORITY,
    "retire-account-deletion-bootstrap-local-secrets-only");
  await assert.rejects(runAccountDeletionLocalRetirementFromApprovedManifest({
    manifestSha256: "a".repeat(64),
    confirmation: "install-or-retire-anything",
  }), /retirement stopped/u);
});
