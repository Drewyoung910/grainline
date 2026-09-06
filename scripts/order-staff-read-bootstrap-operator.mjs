// Isolated release operator. Import is inert. Only the explicit CLI confirmation
// plus externally approved manifest digest can select the fixed production paths.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createStaffBootstrapPrivateInputs, STAFF_BOOTSTRAP_AUTHORITY } from "./order-staff-read-bootstrap-private-inputs.mjs";
import { collectStaffBootstrapObservations } from "./order-staff-read-bootstrap-observations.mjs";
import { coordinateStaffBootstrap } from "./order-staff-read-bootstrap-coordinator.mjs";

const failed = () => new Error("staff bootstrap operator stopped; preserve the exact private inputs and journal");

// Dependency-injection seam for isolated tests. The production entry below does
// not accept these dependencies, credentials, paths, endpoints or environment overrides.
export async function executeStaffBootstrapWithInputs(inputs, { sourceDirectory,
  fetchImpl, readGit, connectionFactory, env = process.env } = {}) {
  try {
    inputs.verifyManifest();
    const result = await coordinateStaffBootstrap({ reviewed: inputs.reviewed, directory: inputs.directory, env,
      loadOwnerCredential: inputs.loadOwnerCredential, connectionFactory,
      observeRelease: async () => {
        inputs.verifyManifest();
        const observations = await collectStaffBootstrapObservations({ reviewed: inputs.reviewed,
          directory: sourceDirectory, loadProviderTokens: inputs.loadProviderTokens,
          observeCredentialEpoch: inputs.observeCredentialEpoch, fetchImpl, readGit, env });
        inputs.verifyManifest();
        return observations;
      },
    });
    inputs.verifyManifest();
    return Object.freeze({ ...result, manifestSha256: inputs.manifestSha256 });
  } catch { throw failed(); }
}

export async function runStaffBootstrapFromApprovedManifest(options) {
  try {
    assert.deepEqual(Object.keys(options).sort(), ["confirmation", "manifestSha256"]);
    assert.equal(options.confirmation, STAFF_BOOTSTRAP_AUTHORITY);
    const inputs = createStaffBootstrapPrivateInputs({ manifestSha256: options.manifestSha256 });
    return await executeStaffBootstrapWithInputs(inputs, { sourceDirectory: process.cwd() });
  } catch { throw failed(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    assert.ok(args.length === 4 && args[0] === "--manifest-sha256" && args[2] === "--confirm");
    const result = await runStaffBootstrapFromApprovedManifest({ manifestSha256: args[1], confirmation: args[3] });
    // Only sanitized receipt fields. The authorized caller may retain stdout in
    // a mode-0600 evidence file; raw provider payloads never reach this stream.
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(`${failed().message}\n`);
    process.exitCode = 1;
  }
}
