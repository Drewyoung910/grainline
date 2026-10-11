// Dormant composition only. No executable entrypoint, production paths,
// observation/credential readers, secret installation or grant convergence.
import assert from "node:assert/strict";
import { assertAccountDeletionBootstrapRelease, assertAccountDeletionBootstrapReviewedBinding } from "./account-deletion-worker-bootstrap-release.mjs";
import { withAccountDeletionBootstrapJournal } from "./account-deletion-worker-bootstrap-journal.mjs";
import { newAccountDeletionBootstrapState, runAccountDeletionBootstrapCore } from "./account-deletion-worker-role-bootstrap.mjs";
import { accountDeletionBootstrapConnectionOperations } from "./account-deletion-worker-bootstrap-connection.mjs";

export async function coordinateAccountDeletionBootstrap({ reviewed: input, directory, observeRelease,
  loadOwnerCredential, connectionFactory = accountDeletionBootstrapConnectionOperations, env = process.env }) {
  let phase = "release-admission";
  try {
    // Never let a caller change the admitted binding during an awaited read.
    const reviewed = assertAccountDeletionBootstrapReviewedBinding(input);
    const environment = Object.freeze({ ...env });
    for (const callback of [observeRelease, loadOwnerCredential, connectionFactory]) assert.equal(typeof callback, "function");
    const attest = async () => assertAccountDeletionBootstrapRelease({ ...await observeRelease(), reviewed });
    const binding = Object.freeze({ releaseCommit: reviewed.releaseCommit, ciRunId: reviewed.ciRunId });
    phase = "private-journal";
    return await withAccountDeletionBootstrapJournal({ directory, binding }, async journal => {
      // Full observation includes reading private files to check the accepted
      // credential epoch. No observer/credential callback runs before this lock.
      phase = "release-admission";
      await attest();
      phase = "credential-admission";
      const credential = await loadOwnerCredential();
      assert.ok(credential && typeof credential.url === "string" &&
        credential.epochSha256 === reviewed.credentialEpochSha256);
      const saved = journal.read();
      const state = saved ?? newAccountDeletionBootstrapState(binding);
      const connection = connectionFactory({ ownerUrl: credential.url, state, binding, env: environment });
      assert.equal(typeof connection?.executeOwnerTransaction, "function");
      assert.equal(typeof connection?.proveSeparateLogin, "function");
      if (!saved) journal.persistPrivateState(state);
      phase = "bootstrap";
      const result = await runAccountDeletionBootstrapCore({ state, binding, operations: {
        persistPrivateState: journal.persistPrivateState,
        async executeOwnerTransaction(sql) {
          await attest();
          // Readback rechecks lock, permissions, immutable state and durability
          // immediately before delegating SQL to the fresh owner connection.
          const persisted = journal.read();
          assert.ok(persisted.stage === "create-pending" && persisted.attemptId === state.attemptId);
          await connection.executeOwnerTransaction(sql);
        },
        async proveSeparateLogin(password) {
          await attest();
          journal.read();
          return connection.proveSeparateLogin(password);
        },
      } });
      phase = "final-release-attestation";
      const accepted = await attest();
      journal.read();
      return Object.freeze({ ...result, tlsProofRunId: accepted.tlsProofRunId,
        tlsProofJobId: accepted.tlsProofJobId, tlsProofRunAttempt: accepted.tlsProofRunAttempt,
        deploymentId: accepted.deploymentId, credentialEpochSha256: accepted.credentialEpochSha256 });
    });
  } catch {
    throw new Error(`account deletion bootstrap coordinator stopped during ${phase}; preserve the exact private attempt`);
  }
}
