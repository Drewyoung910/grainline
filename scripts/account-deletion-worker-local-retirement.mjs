// Local-only completion for a credential installed by an older exact-release
// operator. It performs one read-only provider inventory, then retires local
// plaintext state and the operation-local provider-token file. It never writes
// a provider resource, connects to PostgreSQL, applies SQL, or deploys.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createAccountDeletionBootstrapPrivateInputs } from "./account-deletion-worker-bootstrap-private-inputs.mjs";
import { withAccountDeletionBootstrapJournal } from "./account-deletion-worker-bootstrap-journal.mjs";
import { assertAccountDeletionBootstrapReviewedBinding } from "./account-deletion-worker-bootstrap-release.mjs";
import { retireAccountDeletionBootstrapCredential } from "./account-deletion-worker-role-bootstrap.mjs";
import { inspectAccountDeletionDatabaseUrl } from "./account-deletion-worker-vercel-env.mjs";

export const ACCOUNT_DELETION_LOCAL_RETIREMENT_AUTHORITY =
  "retire-account-deletion-bootstrap-local-secrets-only";
const stopped = () => new Error(
  "account deletion local credential retirement stopped; preserve the exact private attempt",
);

export async function executeAccountDeletionLocalRetirementWithInputs(inputs, {
  inspect = inspectAccountDeletionDatabaseUrl,
  fetchImpl,
} = {}) {
  try {
    inputs.verifyManifest();
    assert.equal(typeof inputs.retireProviderTokens, "function");
    const reviewed = assertAccountDeletionBootstrapReviewedBinding(inputs.reviewed);
    const binding = Object.freeze({
      releaseCommit: reviewed.releaseCommit,
      ciRunId: reviewed.ciRunId,
    });
    return await withAccountDeletionBootstrapJournal({ directory: inputs.directory, binding }, async journal => {
      let state = journal.read();
      if (state?.stage === "role-verified") {
        const tokens = inputs.loadProviderTokens();
        const installation = await inspect({
          state,
          binding,
          vercelToken: tokens.vercel,
          fetchImpl,
        });
        inputs.verifyManifest();
        assert.equal(journal.read().attemptId, state.attemptId);
        state = retireAccountDeletionBootstrapCredential(state, binding, installation);
        journal.persistPrivateState(state);
      } else {
        assert.equal(state?.stage, "credential-installed");
      }
      inputs.retireProviderTokens();
      inputs.verifyManifest();
      assert.deepEqual(journal.read(), state);
      return Object.freeze({
        status: "credential-installed",
        role: state.role,
        releaseCommit: state.releaseCommit,
        ciRunId: state.ciRunId,
        attemptId: state.attemptId,
        environmentId: state.environmentId,
        valueSha256: state.valueSha256,
        manifestSha256: inputs.manifestSha256,
        localCredentialRetired: true,
        providerTokensRetired: true,
        providerMutation: false,
      });
    });
  } catch { throw stopped(); }
}

export async function runAccountDeletionLocalRetirementFromApprovedManifest(options) {
  try {
    assert.deepEqual(Object.keys(options).sort(), ["confirmation", "manifestSha256"]);
    assert.equal(options.confirmation, ACCOUNT_DELETION_LOCAL_RETIREMENT_AUTHORITY);
    const inputs = createAccountDeletionBootstrapPrivateInputs({
      manifestSha256: options.manifestSha256,
    });
    return await executeAccountDeletionLocalRetirementWithInputs(inputs);
  } catch { throw stopped(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.length === 4 && args[0] === "--manifest-sha256" && args[2] === "--confirm");
    const result = await runAccountDeletionLocalRetirementFromApprovedManifest({
      manifestSha256: args[1],
      confirmation: args[3],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${stopped().message}\n`);
    process.exitCode = 1;
  }
}
