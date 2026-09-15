// Dormant composition only. No executable entrypoint, production paths,
// observation/credential readers, secret installation or grant convergence.
import assert from "node:assert/strict";
import { assertStaffBootstrapRelease, assertStaffBootstrapReviewedBinding } from "./order-staff-read-bootstrap-release.mjs";
import { withStaffBootstrapJournal } from "./order-staff-read-bootstrap-journal.mjs";
import { newStaffBootstrapState, runStaffBootstrapCore } from "./order-staff-read-role-bootstrap.mjs";
import { staffBootstrapConnectionOperations } from "./order-staff-read-bootstrap-connection.mjs";

export async function coordinateStaffBootstrap({ reviewed: input, directory, observeRelease,
  loadOwnerCredential, connectionFactory = staffBootstrapConnectionOperations, env = process.env }) {
  let phase = "release-admission";
  try {
    // Never let a caller change the admitted binding during an awaited read.
    const reviewed = assertStaffBootstrapReviewedBinding(input);
    const environment = Object.freeze({ ...env });
    for (const callback of [observeRelease, loadOwnerCredential, connectionFactory]) assert.equal(typeof callback, "function");
    const attest = async () => assertStaffBootstrapRelease({ ...await observeRelease(), reviewed });
    const binding = Object.freeze({ releaseCommit: reviewed.releaseCommit, ciRunId: reviewed.ciRunId });
    phase = "private-journal";
    return await withStaffBootstrapJournal({ directory, binding }, async journal => {
      // Full observation includes reading private files to check the accepted
      // credential epoch. No observer/credential callback runs before this lock.
      phase = "release-admission";
      await attest();
      phase = "credential-admission";
      const credential = await loadOwnerCredential();
      assert.ok(credential && typeof credential.url === "string" &&
        credential.epochSha256 === reviewed.credentialEpochSha256);
      const saved = journal.read();
      const state = saved ?? newStaffBootstrapState(binding);
      const connection = connectionFactory({ ownerUrl: credential.url, state, binding, env: environment });
      assert.equal(typeof connection?.executeOwnerTransaction, "function");
      assert.equal(typeof connection?.proveSeparateLogin, "function");
      if (!saved) journal.persistPrivateState(state);
      phase = "bootstrap";
      const result = await runStaffBootstrapCore({ state, binding, operations: {
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
    throw new Error(`staff bootstrap coordinator stopped during ${phase}; preserve the exact private attempt`);
  }
}
