// Separate provider operator. It never creates a role, applies grants or SQL,
// deploys application code, moves aliases, or changes any other environment key.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAccountDeletionBootstrapPrivateInputs } from "./account-deletion-worker-bootstrap-private-inputs.mjs";
import { collectAccountDeletionBootstrapObservations } from "./account-deletion-worker-bootstrap-observations.mjs";
import { withAccountDeletionBootstrapJournal } from "./account-deletion-worker-bootstrap-journal.mjs";
import { assertAccountDeletionBootstrapReviewedBinding } from "./account-deletion-worker-bootstrap-release.mjs";
import { installAccountDeletionDatabaseUrl } from "./account-deletion-worker-vercel-env.mjs";

export const ACCOUNT_DELETION_VERCEL_ENV_AUTHORITY = "install-account-deletion-production-database-url-only";
const stopped = () => new Error("account deletion Vercel environment operator stopped; preserve the exact private attempt");

export function accountDeletionVercelOperatorSourceDirectory(moduleUrl, workingDirectory) {
  try {
    const script = fileURLToPath(moduleUrl);
    assert.equal(moduleUrl, pathToFileURL(script).href);
    assert.equal(fs.realpathSync(script), script);
    assert.equal(path.basename(script), "account-deletion-worker-vercel-env-operator.mjs");
    assert.equal(path.basename(path.dirname(script)), "scripts");
    const directory = path.dirname(path.dirname(script));
    assert.equal(workingDirectory, directory);
    assert.equal(fs.realpathSync(directory), directory);
    return directory;
  } catch { throw stopped(); }
}

export async function executeAccountDeletionVercelEnvironmentWithInputs(inputs, {
  sourceDirectory, collectObservations = collectAccountDeletionBootstrapObservations,
  install = installAccountDeletionDatabaseUrl, fetchImpl, readGit, env = process.env,
} = {}) {
  try {
    inputs.verifyManifest();
    const reviewed = assertAccountDeletionBootstrapReviewedBinding(inputs.reviewed);
    const binding = Object.freeze({ releaseCommit: reviewed.releaseCommit, ciRunId: reviewed.ciRunId });
    return await withAccountDeletionBootstrapJournal({ directory: inputs.directory, binding }, async journal => {
      const state = journal.read();
      assert.equal(state?.stage, "role-verified");
      const observe = () => collectObservations({ reviewed, directory: sourceDirectory,
        loadProviderTokens: inputs.loadProviderTokens, observeCredentialEpoch: inputs.observeCredentialEpoch,
        fetchImpl, readGit, env });
      await observe();
      inputs.verifyManifest();
      assert.equal(journal.read().attemptId, state.attemptId);
      const tokens = inputs.loadProviderTokens();
      const result = await install({ state, binding, vercelToken: tokens.vercel, fetchImpl });
      await observe();
      inputs.verifyManifest();
      assert.equal(journal.read().attemptId, state.attemptId);
      return Object.freeze({ ...result, releaseCommit: reviewed.releaseCommit,
        ciRunId: reviewed.ciRunId, attemptId: state.attemptId, manifestSha256: inputs.manifestSha256 });
    });
  } catch { throw stopped(); }
}

export async function runAccountDeletionVercelEnvironmentFromApprovedManifest(options) {
  try {
    assert.deepEqual(Object.keys(options).sort(), ["confirmation", "manifestSha256"]);
    assert.equal(options.confirmation, ACCOUNT_DELETION_VERCEL_ENV_AUTHORITY);
    const sourceDirectory = accountDeletionVercelOperatorSourceDirectory(import.meta.url, process.cwd());
    const inputs = createAccountDeletionBootstrapPrivateInputs({ manifestSha256: options.manifestSha256 });
    return await executeAccountDeletionVercelEnvironmentWithInputs(inputs, { sourceDirectory });
  } catch { throw stopped(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.length === 4 && args[0] === "--manifest-sha256" && args[2] === "--confirm");
    const result = await runAccountDeletionVercelEnvironmentFromApprovedManifest({
      manifestSha256: args[1], confirmation: args[3],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${stopped().message}\n`);
    process.exitCode = 1;
  }
}
