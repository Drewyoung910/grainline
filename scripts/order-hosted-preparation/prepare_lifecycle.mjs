// Preparation only. No load, admission, database, inspection or execution API.
import assert from 'node:assert/strict';

export async function observePreparation(worker) {
  try {
    const installed = await worker.prepare();
    const status = await worker.status();
    for (const value of [installed, status]) {
      assert.equal(value.state, 'installed');
      assert.equal(value.workerPid, worker.pid);
      assert.equal(value.installedToolchainProven, true);
      assert.equal(value.loadedReleaseGraphProven, false);
      assert.equal(value.completeProductionScope, false);
      assert.equal(value.productionExecutionAuthorized, false);
      assert.match(value.sessionId, /^[a-f0-9-]{36}$/u);
    }
    assert.equal(status.sessionId, installed.sessionId);
    return { workerPid: worker.pid, sessionId: status.sessionId,
      state: 'installed', installedToolchainProven: true,
      loadedReleaseGraphProven: false, completeProductionScope: false,
      productionExecutionAuthorized: false };
  } finally {
    await worker.close();
  }
}
