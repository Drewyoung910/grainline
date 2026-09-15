// Dormant internal composition. The worker owns all capabilities; no CLI,
// public production command, credential loading or workflow wiring exists.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createOrderExecutionWatch } from "./order-zero-direct-execution-watch.mjs";
import { executeOrderZeroDirectPrefix } from "./order-zero-direct-execution.mjs";

export function createOrderAdmittedExecutor({ sourceRoot, scope, files, binding, parent,
  admit, readAudited, connect, prisma, onLost }) {
  let started = false;
  return async payload => {
    assert.equal(started, false, "an execution lifetime cannot be resumed or replayed"); started = true;
    assert.deepEqual(Object.keys(payload).sort(), ["admission", "ci", "githubToken", "ownerUrl", "ownerUrlSha256"]);
    // Own a detached immutable copy before the first await. Nothing from IPC
    // can change job/run/credential identity during this lifetime.
    const bound = structuredClone(payload);
    Object.freeze(bound.admission); Object.freeze(bound.ci); Object.freeze(bound);
    const watch = createOrderExecutionWatch({ verify: () => admit(bound), onLost });
    const read = async () => {
      await watch.check(); const observed = await readAudited(bound);
      await watch.check(); return observed;
    };
    try {
      await watch.check();
      const before = await read(); scope.assertAuditedSnapshot(before, "restart", "production");
      const artifact = files.stage(before.ledgerRows, parent);
      await watch.check(); files.verify(artifact);
      const journalDirectory = fs.mkdtempSync(path.join(parent, "execution-journal-")); fs.chmodSync(journalDirectory, 0o700);
      return await executeOrderZeroDirectPrefix({ sourceRoot, scope, files, artifact, binding, parent, journalDirectory,
        mode: "production", guard: watch.check, readAudited: read,
        connect: async () => {
          await watch.check(); const client = await connect(bound);
          try {
            await watch.check();
            return Object.freeze({
              query: async (sql, args) => {
                // Cleanup must remain possible after admission is poisoned.
                if (sql === "ROLLBACK") return client.query(sql, args);
                await watch.check(); const result = await client.query(sql, args);
                await watch.check(); return result;
              },
              end: () => client.end(),
            });
          } catch (error) { await client.end(); throw error; }
        },
        prisma: async (args, checkpoint) => {
          await watch.check(); await prisma(bound, args, checkpoint);
          await watch.check();
        },
      });
    } finally { await watch.close(); }
  };
}
